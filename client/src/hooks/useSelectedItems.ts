import { useCallback, useEffect, useRef, useState } from "react";

import type { SelectedItemsPageRequest } from "@inventory/shared";

import { ApiRequestError } from "../api/api-error";
import { getSelectedItems } from "../api/selected-items.api";
import { SelectedItemsCache } from "../services/selected-items-cache";
import type { CachedSelectedPage } from "../services/selected-items-cache";

const INITIAL_REQUEST: SelectedItemsPageRequest = {};

type LoadError = {
  request: SelectedItemsPageRequest;
  message: string;
};

type SelectedItemsState = {
  pages: CachedSelectedPage[];
  loading: SelectedItemsPageRequest | null;
  error: LoadError | null;
  initialized: boolean;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useSelectedItems(beforeChange: () => Set<string>) {
  const [cache] = useState(() => new SelectedItemsCache());

  const [state, setState] = useState<SelectedItemsState>({
    pages: [],
    loading: INITIAL_REQUEST,
    error: null,
    initialized: false,
  });

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
        const page = await getSelectedItems(controller.signal, request);

        if (
          controller.signal.aborted ||
          !mountedRef.current ||
          requestRef.current !== controller
        ) {
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
            error instanceof ApiRequestError
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
      }
    },
    [cache, beforeChange],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    void Promise.resolve().then(() => {
      if (!cancelled) {
        void requestPage(INITIAL_REQUEST);
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [requestPage]);

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
