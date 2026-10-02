import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { RefObject } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";

import type { PageRequest } from "../api/items.api";
import { useAvailableItems } from "../hooks/useAvailableItems";
import { areAdjacent } from "../services/available-items-cache";

type BoundaryProps = {
  rootRef: RefObject<HTMLDivElement | null>;
  backwardCursor: string | null;
  forwardCursor: string | null;
  disabled: boolean;
  onLoad: (request: PageRequest) => void;
};

function LoadBoundary({
  rootRef,
  backwardCursor,
  forwardCursor,
  disabled,
  onLoad,
}: BoundaryProps) {
  const markerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const marker = markerRef.current;

    if (
      disabled ||
      root === null ||
      marker === null ||
      (backwardCursor === null && forwardCursor === null)
    ) {
      return;
    }

    let active = true;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((item) => item.isIntersecting);

        if (!active || entry === undefined) return;

        const midpoint =
          root.getBoundingClientRect().top + root.clientHeight / 2;

        // Разрыв над пользователем восстанавливаем назад,
        // разрыв под пользователем — вперёд.
        const backward =
          backwardCursor !== null &&
          (forwardCursor === null || entry.boundingClientRect.top < midpoint);

        const cursor = backward ? backwardCursor : forwardCursor;

        if (cursor !== null) {
          onLoad({
            direction: backward ? "backward" : "forward",
            cursor,
          });
        }
      },
      {
        root,
        rootMargin: "160px 0px",
        threshold: 0,
      },
    );

    observer.observe(marker);

    return () => {
      active = false;
      observer.disconnect();
    };
  }, [rootRef, backwardCursor, forwardCursor, disabled, onLoad]);

  return <Box ref={markerRef} aria-hidden="true" sx={{ height: 24 }} />;
}

export function AvailableItemsList() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<{
    id: string;
    offset: number;
  } | null>(null);

  const captureViewport = useCallback(() => {
    const root = rootRef.current;
    const visibleKeys = new Set<string>();
    anchorRef.current = null;

    if (root === null) return visibleKeys;

    const top = root.getBoundingClientRect().top + root.clientTop;
    const bottom = top + root.clientHeight;

    const blocks = root.querySelectorAll<HTMLElement>("[data-page-key]");

    for (const block of blocks) {
      const rect = block.getBoundingClientRect();

      if (rect.bottom <= top || rect.top >= bottom) {
        continue;
      }

      const key = block.dataset.pageKey;

      if (key !== undefined) {
        visibleKeys.add(key);
      }

      if (anchorRef.current !== null) continue;

      const rows = block.querySelectorAll<HTMLElement>("[data-item-id]");

      for (const row of rows) {
        const rowRect = row.getBoundingClientRect();

        if (rowRect.bottom > top && rowRect.top < bottom) {
          anchorRef.current = {
            id: row.dataset.itemId!,
            offset: rowRect.top - top,
          };
          break;
        }
      }
    }

    return visibleKeys;
  }, []);

  const { pages, loading, error, initialized, loadPage, retry, touchPage } =
    useAvailableItems(captureViewport);

  const disabled = loading !== null || error !== null;
  const count = pages.reduce((total, page) => total + page.data.ids.length, 0);

  // Восстанавливаем положение до отрисовки кадра браузером.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const anchor = anchorRef.current;
    anchorRef.current = null;

    if (root === null || anchor === null) return;

    const row = root.querySelector<HTMLElement>(
      `[data-item-id="${anchor.id}"]`,
    );

    if (row === null) return;

    const top = root.getBoundingClientRect().top + root.clientTop;
    const offset = row.getBoundingClientRect().top - top;

    root.scrollTop += offset - anchor.offset;
  }, [pages]);

  // Обращение к странице при прокрутке обновляет её LRU-позицию.
  useEffect(() => {
    const root = rootRef.current;

    if (root === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const key = (entry.target as HTMLElement).dataset.pageKey;

          if (key !== undefined) {
            touchPage(key);
          }
        }
      },
      { root },
    );

    for (const block of root.querySelectorAll("[data-page-key]")) {
      observer.observe(block);
    }

    return () => observer.disconnect();
  }, [pages, touchPage]);

  const lastPage = pages[pages.length - 1];

  return (
    <>
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Доступно без загрузки: {count}
        </Typography>

        {loading !== null && (
          <Stack
            direction="row"
            spacing={1}
            role="status"
            sx={{ mt: 1, alignItems: "center" }}
          >
            <CircularProgress size={20} aria-hidden="true" />
            <Typography variant="body2">Загрузка элементов…</Typography>
          </Stack>
        )}

        {error !== null && (
          <Alert
            severity="error"
            sx={{ mt: 1 }}
            action={
              <Button color="inherit" onClick={retry}>
                Повторить
              </Button>
            }
          >
            {error.message}
          </Alert>
        )}
      </Box>

      <Box
        ref={rootRef}
        role="region"
        aria-labelledby="available-items-heading"
        aria-busy={loading !== null}
        tabIndex={0}
        sx={{
          height: 480,
          overflowY: "auto",
          overflowAnchor: "none",
          overscrollBehavior: "contain",
          scrollbarGutter: "stable",
          px: 2,
        }}
      >
        {initialized && pages.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            Нет доступных элементов.
          </Typography>
        )}

        {pages.map((page, index) => {
          const previous = pages[index - 1];
          const hasGap = previous !== undefined && !areAdjacent(previous, page);

          return (
            <Fragment key={page.key}>
              {(index === 0 || hasGap) && (
                <LoadBoundary
                  rootRef={rootRef}
                  backwardCursor={page.data.prevCursor}
                  forwardCursor={
                    hasGap && previous !== undefined
                      ? previous.data.nextCursor
                      : null
                  }
                  disabled={disabled}
                  onLoad={loadPage}
                />
              )}

              <Box
                component="ul"
                data-page-key={page.key}
                aria-labelledby="available-items-heading"
                sx={{ m: 0, p: 0, listStyle: "none" }}
              >
                {page.data.ids.map((id) => (
                  <ListItem key={id} data-item-id={id} divider>
                    <ListItemText primary={`ID: ${id}`} />
                  </ListItem>
                ))}
              </Box>
            </Fragment>
          );
        })}

        {lastPage !== undefined &&
          (lastPage.data.hasNext ? (
            <LoadBoundary
              rootRef={rootRef}
              backwardCursor={null}
              forwardCursor={lastPage.data.nextCursor}
              disabled={disabled}
              onLoad={loadPage}
            />
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              Конец списка.
            </Typography>
          ))}
      </Box>
    </>
  );
}
