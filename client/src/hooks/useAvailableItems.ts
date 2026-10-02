import { useEffect, useState, useRef, useCallback, useMemo } from "react";

import type { AvailableItemsPageRequest } from "@inventory/shared";

import { getAvailableItems } from "../api/items.api";
import { AvailableItemsCache } from "../services/available-items-cache";
import type { CachedPage } from "../services/available-items-cache";
import { ApiRequestError } from "../api/api-error";

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

export function useAvailableItems(
  search: string,
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

      try {
        const page = await getAvailableItems(controller.signal, request);

        if (controller.signal.aborted || !mountedRef.current) {
          return;
        }

        const visibleKeys = beforeChange();

        for (const key of visibleKeys) {
          cache.touch(key);
        }

        cache.insert(page, request, visibleKeys);

        setState({
          pages: cache.snapshot(),
          loading: null,
          error: null,
          initialized: true,
        });
      } catch (error) {
        if (controller.signal.aborted || !mountedRef.current) {
          return;
        }

        const failure: LoadError = {
          request,
          message:
            error instanceof ApiRequestError
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
      }
    },
    [cache, beforeChange],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    void Promise.resolve().then(() => {
      if (!cancelled) {
        void requestPage(initialRequest);
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [requestPage, initialRequest]);

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
