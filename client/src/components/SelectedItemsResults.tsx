import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
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

import type { OptimisticSelection } from "../types/selection";

import { useSelectedItems } from "../hooks/useSelectedItems";
import { areSelectedPagesAdjacent } from "../services/selected-items-cache";

import { SelectedItemsLoadBoundary } from "./SelectedItemsLoadBoundary";

const ROW_HEIGHT = 48;
const OVERSCAN = 8;

type ItemRow = {
  kind: "item";
  key: string;
  id: number;
  pageKey: string | null;
  optimistic: boolean;
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

type SelectedItemsResultsProps = {
  search: string;
  revision: number;
  mutationPending: boolean;
  optimisticSelection: OptimisticSelection;
  onInitialLoadSettled: () => void;
  onReconciled: (revision: number) => void;
  onUnselect: (id: number) => Promise<void>;
};

function matchesSearch(id: number, search: string): boolean {
  return search === "" || String(id).includes(search);
}

export function SelectedItemsResults({
  search,
  revision,
  mutationPending,
  optimisticSelection,
  onInitialLoadSettled,
  onReconciled,
  onUnselect,
}: SelectedItemsResultsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const anchorRef = useRef<{
    key: string;
    offset: number;
  } | null>(null);

  const captureViewportRef = useRef<() => Set<string>>(() => new Set<string>());

  const captureViewport = useCallback(() => captureViewportRef.current(), []);

  const { pages, loading, error, initialized, loadPage, retry, touchPage } =
    useSelectedItems(search, captureViewport);

  const disabled = loading !== null || error !== null;

  useEffect(() => {
    if (initialized || error !== null) {
      onInitialLoadSettled();
    }
  }, [initialized, error, onInitialLoadSettled]);

  useEffect(() => {
    if (initialized) {
      onReconciled(revision);
    }
  }, [initialized, revision, onReconciled]);

  const { rows, detachedPendingIds } = useMemo<{
    rows: VirtualRow[];
    detachedPendingIds: number[];
  }>(() => {
    const result: VirtualRow[] = [];
    const detached: number[] = [];

    for (const [pageIndex, page] of pages.entries()) {
      const previous = pages[pageIndex - 1];

      const hasGap =
        previous !== undefined && !areSelectedPagesAdjacent(previous, page);

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
        const operation = optimisticSelection.get(id);

        if (operation?.action === "unselect") {
          continue;
        }

        result.push({
          kind: "item",
          key: `item:${id}`,
          id,
          pageKey: page.key,
          optimistic: operation?.action === "select",
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

    for (const [id, operation] of optimisticSelection) {
      if (operation.action !== "select" || !matchesSearch(id, search)) {
        continue;
      }

      const alreadyConfirmed = result.some(
        (row) => row.kind === "item" && row.id === id,
      );

      if (alreadyConfirmed) {
        continue;
      }

      const endIndex = result.findIndex((row) => row.kind === "end");

      const confirmedFilteredListIsEmpty =
        initialized && pages.length === 0 && result.length === 0;

      if (endIndex >= 0) {
        result.splice(endIndex, 0, {
          kind: "item",
          key: `optimistic-item:${id}`,
          id,
          pageKey: null,
          optimistic: true,
        });

        continue;
      }

      if (confirmedFilteredListIsEmpty) {
        result.push({
          kind: "item",
          key: `optimistic-item:${id}`,
          id,
          pageKey: null,
          optimistic: true,
        });

        continue;
      }

      detached.push(id);
    }

    return { rows: result, detachedPendingIds: detached };
  }, [pages, optimisticSelection, search, initialized]);

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

      if (row.pageKey !== null) {
        visibleKeys.add(row.pageKey);
      }

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

    if (anchor === null) {
      return;
    }

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

      if (row?.kind === "item" && row.pageKey !== null) {
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
        {loading !== null && (
          <Stack
            direction="row"
            spacing={1}
            role="status"
            sx={{ alignItems: "center" }}
          >
            <CircularProgress size={20} aria-hidden="true" />

            <Typography variant="body2">
              Загрузка выбранных элементов…
            </Typography>
          </Stack>
        )}

        {error !== null && (
          <Alert
            severity="error"
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

      {detachedPendingIds.length > 0 && (
        <Box
          role="list"
          aria-label="Изменения, ожидающие сохранения"
          sx={{
            mx: 2,
            mb: 1,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          {detachedPendingIds.map((id) => (
            <ListItem
              key={`detached-pending:${id}`}
              component="div"
              role="listitem"
              data-pending-item-id={id}
              secondaryAction={
                <Button size="small" disabled>
                  Убрать
                </Button>
              }
              sx={{
                minHeight: ROW_HEIGHT,
                boxSizing: "border-box",
              }}
            >
              <ListItemText primary={`ID: ${id}`} secondary="Сохранение…" />
            </ListItem>
          ))}
        </Box>
      )}

      <Box
        ref={rootRef}
        role="region"
        aria-labelledby="selected-items-heading"
        data-selected-items-scroll
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
        {initialized && rows.length === 0 && detachedPendingIds.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            Нет выбранных элементов.
          </Typography>
        ) : (
          <Box
            role="list"
            aria-labelledby="selected-items-heading"
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
                  data-selected-virtual-row
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
                      data-selected-item-id={row.id}
                      data-selected-page-key={row.pageKey ?? undefined}
                      divider
                      secondaryAction={
                        <Button
                          size="small"
                          disabled={mutationPending || row.optimistic}
                          onClick={() => {
                            void onUnselect(row.id);
                          }}
                        >
                          Убрать
                        </Button>
                      }
                      sx={{
                        height: ROW_HEIGHT,
                        boxSizing: "border-box",
                      }}
                    >
                      <ListItemText
                        primary={`ID: ${row.id}`}
                        secondary={row.optimistic ? "Сохранение…" : undefined}
                      />
                    </ListItem>
                  )}

                  {row.kind === "boundary" && (
                    <SelectedItemsLoadBoundary
                      rootRef={rootRef}
                      before={row.before}
                      after={row.after}
                      disabled={disabled}
                      search={search}
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
