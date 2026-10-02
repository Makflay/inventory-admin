import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useMemo,
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
import { useVirtualizer } from "@tanstack/react-virtual";

import type { AvailableItemsPageRequest } from "@inventory/shared";

import { useAvailableItems } from "../hooks/useAvailableItems";
import { areAdjacent } from "../services/available-items-cache";

const ROW_HEIGHT = 48;
const OVERSCAN = 8;

type BoundaryProps = {
  rootRef: RefObject<HTMLDivElement | null>;
  before: string | null;
  after: string | null;
  disabled: boolean;
  onLoad: (request: AvailableItemsPageRequest) => void;
};

type ItemRow = {
  kind: "item";
  key: string;
  id: number;
  pageKey: string;
};

type BoundaryRow = {
  kind: "boundary";
  key: string;
  before: string | null;
  after: string | null;
};

type EndRow = {
  kind: "end";
  key: string;
};

type VirtualRow = ItemRow | BoundaryRow | EndRow;

function LoadBoundary({
  rootRef,
  before,
  after,
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
      (before === null && after === null)
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

        const loadBefore =
          before !== null &&
          (after === null || entry.boundingClientRect.top < midpoint);

        if (loadBefore && before !== null) {
          onLoad({ before });
        } else if (after !== null) {
          onLoad({ after });
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
  }, [rootRef, before, after, disabled, onLoad]);

  return <Box ref={markerRef} aria-hidden="true" sx={{ height: ROW_HEIGHT }} />;
}

export function AvailableItemsList() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<{
    key: string;
    offset: number;
  } | null>(null);

  const captureViewportRef = useRef<() => Set<string>>(() => new Set<string>());
  const captureViewport = useCallback(() => captureViewportRef.current(), []);

  const { pages, loading, error, initialized, loadPage, retry, touchPage } =
    useAvailableItems(captureViewport);

  const disabled = loading !== null || error !== null;
  const count = pages.reduce((total, page) => total + page.data.ids.length, 0);

  const rows = useMemo<VirtualRow[]>(() => {
    const result: VirtualRow[] = [];

    for (const [pageIndex, page] of pages.entries()) {
      const previous = pages[pageIndex - 1];
      const hasGap = previous !== undefined && !areAdjacent(previous, page);

      if (pageIndex === 0 || hasGap) {
        const before = page.data.pageInfo.hasPreviousPage
          ? page.data.pageInfo.startCursor
          : null;

        const after =
          hasGap && previous !== undefined && previous.data.pageInfo.hasNextPage
            ? previous.data.pageInfo.endCursor
            : null;

        if (before !== null || after !== null) {
          result.push({
            kind: "boundary",
            key: `boundary:${previous?.key ?? "start"}:${page.key}`,
            before,
            after,
          });
        }
      }

      for (const id of page.data.ids) {
        result.push({
          kind: "item",
          key: `item:${id}`,
          id,
          pageKey: page.key,
        });
      }
    }

    const lastPage = pages[pages.length - 1];

    if (lastPage !== undefined) {
      if (
        lastPage.data.pageInfo.hasNextPage &&
        lastPage.data.pageInfo.endCursor !== null
      ) {
        result.push({
          kind: "boundary",
          key: `boundary:${lastPage.key}:end`,
          before: null,
          after: lastPage.data.pageInfo.endCursor,
        });
      } else {
        result.push({
          kind: "end",
          key: "end",
        });
      }
    }

    return result;
  }, [pages]);

  const getItemKey = useCallback(
    (index: number) => rows[index]?.key ?? index,
    [rows],
  );

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => rootRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey,
    overscan: OVERSCAN,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  captureViewportRef.current = () => {
    const root = rootRef.current;
    const visibleKeys = new Set<string>();

    anchorRef.current = null;

    if (root === null) {
      return visibleKeys;
    }

    const viewportStart = root.scrollTop;
    const viewportEnd = viewportStart + root.clientHeight;

    for (const virtualItem of rowVirtualizer.getVirtualItems()) {
      if (
        virtualItem.end <= viewportStart ||
        virtualItem.start >= viewportEnd
      ) {
        continue;
      }

      const row = rows[virtualItem.index];

      if (row?.kind !== "item") {
        continue;
      }

      visibleKeys.add(row.pageKey);

      if (anchorRef.current === null) {
        anchorRef.current = {
          key: row.key,
          offset: virtualItem.start - viewportStart,
        };
      }
    }

    return visibleKeys;
  };

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;

    if (anchor === null) return;

    const anchorIndex = rows.findIndex((row) => row.key === anchor.key);

    if (anchorIndex < 0) {
      return;
    }

    const nextOffset = anchorIndex * ROW_HEIGHT - anchor.offset;

    rowVirtualizer.scrollToOffset(Math.max(0, nextOffset), {
      behavior: "auto",
    });
  }, [rows, rowVirtualizer]);

  useEffect(() => {
    const root = rootRef.current;

    if (root === null) {
      return;
    }

    const viewportStart = root.scrollTop;
    const viewportEnd = viewportStart + root.clientHeight;
    const visiblePageKeys = new Set<string>();

    for (const virtualItem of virtualItems) {
      if (
        virtualItem.end <= viewportStart ||
        virtualItem.start >= viewportEnd
      ) {
        continue;
      }

      const row = rows[virtualItem.index];

      if (row?.kind === "item") {
        visiblePageKeys.add(row.pageKey);
      }
    }

    for (const pageKey of visiblePageKeys) {
      touchPage(pageKey);
    }
  }, [rows, virtualItems, touchPage]);

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
        data-available-items-scroll
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
        {initialized && pages.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            Нет доступных элементов.
          </Typography>
        ) : (
          <Box
            role="list"
            aria-labelledby="available-items-heading"
            sx={{
              position: "relative",
              width: "100%",
              height: rowVirtualizer.getTotalSize(),
            }}
          >
            {virtualItems.map((virtualItem) => {
              const row = rows[virtualItem.index];

              if (row === undefined) {
                return null;
              }

              return (
                <Box
                  key={row.key}
                  data-virtual-row
                  data-index={virtualItem.index}
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualItem.size,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {row.kind === "item" && (
                    <ListItem
                      component="div"
                      role="listitem"
                      data-item-id={row.id}
                      data-page-key={row.pageKey}
                      divider
                      sx={{
                        height: ROW_HEIGHT,
                        boxSizing: "border-box",
                      }}
                    >
                      <ListItemText primary={`ID: ${row.id}`} />
                    </ListItem>
                  )}

                  {row.kind === "boundary" && (
                    <LoadBoundary
                      rootRef={rootRef}
                      before={row.before}
                      after={row.after}
                      disabled={disabled}
                      onLoad={loadPage}
                    />
                  )}

                  {row.kind === "end" && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        height: ROW_HEIGHT,
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      Конец списка.
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </>
  );
}
