import { useEffect, useState, useRef, useCallback } from "react";

import { getAvailableItems } from "../api/items.api";
import type { AvailableItemsPage } from "../api/items.api";

type LoadedPage = {
  requestCursor: string | null;
  data: AvailableItemsPage;
};

type AvailableItemsState = {
  pages: LoadedPage[];
  isLoading: boolean;
  error: string | null;
};

type UseAvailableItemsResult = AvailableItemsState & {
  hasMore: boolean;
  loadNextPage: () => void;
  retry: () => void;
};

export function useAvailableItems(): UseAvailableItemsResult {
  const [state, setState] = useState<AvailableItemsState>({
    pages: [],
    isLoading: true,
    error: null,
  });

  const mountedRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const loadedCursorsRef = useRef(new Set<string | null>());
  const nextCursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const errorRef = useRef(false);

  const requestPage = useCallback(
    async (cursor: string | null, retry = false) => {
      if (
        !mountedRef.current ||
        requestRef.current !== null ||
        !hasMoreRef.current ||
        loadedCursorsRef.current.has(cursor) ||
        cursor !== nextCursorRef.current ||
        (errorRef.current && !retry)
      ) {
        return;
      }

      const controller = new AbortController();

      requestRef.current = controller;
      errorRef.current = false;

      setState((previous) => ({
        ...previous,
        isLoading: true,
        error: null,
      }));

      try {
        const page = await getAvailableItems(controller.signal, cursor);

        if (controller.signal.aborted || !mountedRef.current) {
          return;
        }

        loadedCursorsRef.current.add(cursor);
        nextCursorRef.current = page.nextCursor;
        hasMoreRef.current = page.hasMore;

        setState((previous) => ({
          pages: [
            ...previous.pages,
            {
              requestCursor: cursor,
              data: page,
            },
          ],
          isLoading: false,
          error: null,
        }));
      } catch (error) {
        if (controller.signal.aborted || !mountedRef.current) {
          return;
        }

        errorRef.current = true;

        setState((previous) => ({
          ...previous,
          isLoading: false,
          error:
            error instanceof Error
              ? error.message
              : "Не удалось загрузить элементы",
        }));
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
        }
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    void Promise.resolve().then(() => {
      if (!cancelled) {
        void requestPage(null);
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [requestPage]);

  const lastPage = state.pages[state.pages.length - 1];
  const nextCursor = lastPage?.data.nextCursor ?? null;
  const hasMore = lastPage?.data.hasMore ?? true;

  const loadNextPage = useCallback(() => {
    if (lastPage === undefined || !hasMore || nextCursor === null) {
      return;
    }

    void requestPage(nextCursor);
  }, [lastPage, hasMore, nextCursor, requestPage]);

  const retry = useCallback(() => {
    void requestPage(nextCursor, true);
  }, [nextCursor, requestPage]);

  return {
    pages: state.pages,
    isLoading: state.isLoading,
    error: state.error,
    hasMore,
    loadNextPage,
    retry,
  };
}
