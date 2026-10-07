import { useCallback, useEffect, useRef, useState, useMemo } from "react";

import type { SelectedItemsPageRequest } from "@inventory/shared";
import type { CachedSelectedPage } from "../services/selected-items-cache";

import { ApiRequestError } from "../api/api-error";
import { SelectedItemsCache } from "../services/selected-items-cache";

import {
  readRequestManager,
  StaleReadError,
} from "../services/read-request-manager";
import {
  getLatestKnownServerVersion,
  subscribeToServerVersion,
} from "../services/server-version";

type LoadError = {
  request: SelectedItemsPageRequest;
  message: string;
};

type SelectedItemsState = {
  pages: CachedSelectedPage[];
  loading: SelectedItemsPageRequest | null;
  error: LoadError | null;
  initialized: boolean;
  datasetVersion: number | null;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useSelectedItems(
  search: string,
  freshnessToken: string,
  beforeChange: () => Set<string>,
) {
  const initialRequest = useMemo<SelectedItemsPageRequest>(
    () => ({ search }),
    [search],
  );
  const [cache] = useState(() => new SelectedItemsCache());
  const [state, setState] = useState<SelectedItemsState>({
    pages: [],
    loading: initialRequest,
    error: null,
    initialized: false,
    datasetVersion: null,
  });
  const cacheVersionRef = useRef<number | null>(null);

  const requestPageRef = useRef<
    (request: SelectedItemsPageRequest, retry?: boolean) => Promise<void>
  >(async () => undefined);

  const mountedRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const errorRef = useRef<LoadError | null>(null);

  const requestPage = useCallback(
    async (request: SelectedItemsPageRequest, retry = false) => {
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
          datasetVersion: null,
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
          | Awaited<ReturnType<typeof readRequestManager.readSelected>>
          | undefined;

        for (let staleAttempt = 0; staleAttempt < 2; staleAttempt++) {
          try {
            result = await readRequestManager.readSelected(
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
              datasetVersion: null,
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
          datasetVersion: cacheVersionRef.current,
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          isAbortError(error) ||
          !mountedRef.current ||
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
                : "Не удалось загрузить выбранные элементы. Попробуйте снова.",
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
    [cache, beforeChange, freshnessToken, initialRequest],
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
        datasetVersion: null,
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
      unsubscribe();

      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [cache, initialRequest]);

  const loadPage = useCallback(
    (request: SelectedItemsPageRequest) => {
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
