import { useEffect, useState, useRef, useCallback, useMemo } from "react";

import type { AvailableItemsPageRequest } from "@inventory/shared";

import { AvailableItemsCache } from "../services/available-items-cache";
import type { CachedPage } from "../services/available-items-cache";
import { ApiRequestError } from "../api/api-error";
import {
  readRequestManager,
  StaleReadError,
} from "../services/read-request-manager";
import {
  getLatestKnownServerVersion,
  subscribeToServerVersion,
} from "../services/server-version";

type LoadError = {
  request: AvailableItemsPageRequest;
  message: string;
};

type AvailableItemsState = {
  pages: CachedPage[];
  loading: AvailableItemsPageRequest | null;
  error: LoadError | null;
  initialized: boolean;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useAvailableItems(
  search: string,
  freshnessToken: string,
  beforeChange: () => Set<string>,
) {
  const initialRequest = useMemo<AvailableItemsPageRequest>(
    () => ({ search }),
    [search],
  );

  const [cache] = useState(() => new AvailableItemsCache());
  const [state, setState] = useState<AvailableItemsState>({
    pages: [],
    loading: initialRequest,
    error: null,
    initialized: false,
  });
  const cacheVersionRef = useRef<number | null>(null);
  const requestPageRef = useRef<
    (request: AvailableItemsPageRequest, retry?: boolean) => Promise<void>
  >(async () => undefined);

  const mountedRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const errorRef = useRef<LoadError | null>(null);

  const requestPage = useCallback(
    async (request: AvailableItemsPageRequest, retry = false) => {
      if (
        !mountedRef.current ||
        requestRef.current !== null ||
        (errorRef.current !== null && !retry)
      ) {
        return;
      }

      const latestVersion = getLatestKnownServerVersion();

      if (
        cacheVersionRef.current !== null &&
        cacheVersionRef.current < latestVersion
      ) {
        cache.clear();
        cacheVersionRef.current = null;

        setState({
          pages: [],
          loading: null,
          error: null,
          initialized: false,
        });
      }

      if (cache.read(request) !== undefined) {
        return;
      }

      if (request.after !== undefined || request.before !== undefined) {
        const anchor = cache.anchor(request);

        if (anchor === undefined) {
          return;
        }

        if (request.after !== undefined && !anchor.data.pageInfo.hasNextPage) {
          return;
        }

        if (
          request.before !== undefined &&
          !anchor.data.pageInfo.hasPreviousPage
        ) {
          return;
        }
      }

      const controller = new AbortController();
      requestRef.current = controller;
      errorRef.current = null;

      setState((previous) => ({
        ...previous,
        loading: request,
        error: null,
      }));

      let restartInitial = false;

      try {
        let result:
          | Awaited<ReturnType<typeof readRequestManager.readAvailable>>
          | undefined;

        for (let staleAttempt = 0; staleAttempt < 2; staleAttempt++) {
          try {
            result = await readRequestManager.readAvailable(
              controller.signal,
              request,
              freshnessToken,
            );

            break;
          } catch (error) {
            if (
              error instanceof StaleReadError &&
              staleAttempt === 0 &&
              !controller.signal.aborted
            ) {
              continue;
            }

            throw error;
          }
        }

        if (result === undefined) {
          throw new ApiRequestError(
            "STALE_READ",
            "Данные изменились во время загрузки. Попробуйте снова.",
          );
        }

        if (
          controller.signal.aborted ||
          !mountedRef.current ||
          requestRef.current !== controller
        ) {
          return;
        }

        const currentCacheVersion = cacheVersionRef.current;

        if (
          currentCacheVersion !== null &&
          result.serverVersion > currentCacheVersion
        ) {
          cache.clear();
          cacheVersionRef.current = result.serverVersion;

          if (request.after !== undefined || request.before !== undefined) {
            restartInitial = true;

            setState({
              pages: [],
              loading: initialRequest,
              error: null,
              initialized: false,
            });

            return;
          }
        } else if (currentCacheVersion === null) {
          cacheVersionRef.current = result.serverVersion;
        }

        const visibleKeys = beforeChange();

        for (const key of visibleKeys) {
          cache.touch(key);
        }

        cache.insert(result.page, request, visibleKeys);

        setState({
          pages: cache.snapshot(),
          loading: null,
          error: null,
          initialized: true,
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          !mountedRef.current ||
          isAbortError(error) ||
          requestRef.current !== controller
        ) {
          return;
        }

        const failure: LoadError = {
          request,
          message:
            error instanceof StaleReadError
              ? "Данные изменились во время загрузки. Попробуйте снова."
              : error instanceof ApiRequestError
                ? error.message
                : "Не удалось загрузить элементы. Попробуйте снова.",
        };

        errorRef.current = failure;

        setState((previous) => ({
          ...previous,
          loading: null,
          error: failure,
        }));
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
        }

        if (restartInitial && mountedRef.current) {
          queueMicrotask(() => {
            if (mountedRef.current) {
              void requestPageRef.current(initialRequest);
            }
          });
        }
      }
    },
    [cache, freshnessToken, initialRequest, beforeChange],
  );

  useEffect(() => {
    requestPageRef.current = requestPage;
  }, [requestPage]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const unsubscribe = subscribeToServerVersion((observedVersion) => {
      if (
        !mountedRef.current ||
        cacheVersionRef.current === null ||
        observedVersion <= cacheVersionRef.current
      ) {
        return;
      }

      requestRef.current?.abort();
      requestRef.current = null;
      errorRef.current = null;

      cache.clear();
      cacheVersionRef.current = null;

      setState({
        pages: [],
        loading: initialRequest,
        error: null,
        initialized: false,
      });

      queueMicrotask(() => {
        if (mountedRef.current) {
          void requestPageRef.current(initialRequest);
        }
      });
    });

    queueMicrotask(() => {
      if (!cancelled) {
        void requestPageRef.current(initialRequest);
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
      unsubscribe();
    };
  }, [cache, initialRequest]);

  const loadPage = useCallback(
    (request: AvailableItemsPageRequest) => {
      void requestPage(request);
    },
    [requestPage],
  );

  const retry = useCallback(() => {
    const failure = errorRef.current;

    if (failure !== null) {
      void requestPage(failure.request, true);
    }
  }, [requestPage]);

  const touchPage = useCallback((key: string) => cache.touch(key), [cache]);

  return {
    ...state,
    loadPage,
    retry,
    touchPage,
  };
}
