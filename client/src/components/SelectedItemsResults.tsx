import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";

import type {
  OptimisticSelection,
  OptimisticReorderOperation,
  QueueReorderInput,
} from "../types/selection";
import type { CachedSelectedPage } from "../services/selected-items-cache";

import { useSelectedItems } from "../hooks/useSelectedItems";
import { areSelectedPagesAdjacent } from "../services/selected-items-cache";
import { SelectedItemsLoadBoundary } from "./SelectedItemsLoadBoundary";
import { SelectedItemRow } from "./SelectedItemRow";

const ROW_HEIGHT = 48;
const OVERSCAN = 8;

type ItemRow = {
  kind: "item";
  key: string;
  id: number;
  pageKey: string | null;
  optimistic: boolean;
  regionKey: string | null;
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

export type SelectedPresentationSnapshot = {
  search: string;
  revision: number;
  pages: readonly CachedSelectedPage[];
  datasetVersion: number;
};

type SelectedItemsResultsProps = {
  search: string;
  revision: number;
  selectionActionsDisabled: boolean;
  optimisticSelection: OptimisticSelection;
  optimisticReorders: readonly OptimisticReorderOperation[];
  fallbackSnapshot: SelectedPresentationSnapshot | null;
  fallbackScrollOffsetRef: RefObject<number>;
  onInitialLoadSettled: () => void;
  onReconciled: (revision: number) => void;
  onUnselect: (id: number) => void;
  onReorder: (input: QueueReorderInput) => boolean;
  onPresentationSnapshot: (
    snapshot: SelectedPresentationSnapshot,
    scrollOffset: number,
  ) => void;
  onPresentationScroll: (scrollOffset: number) => void;
};

function matchesSearch(id: number, search: string): boolean {
  return search === "" || String(id).includes(search);
}

function applyOptimisticReorders(
  rows: VirtualRow[],
  operations: readonly OptimisticReorderOperation[],
  search: string,
): VirtualRow[] {
  const result = [...rows];

  for (const operation of operations) {
    if (operation.search !== search) {
      continue;
    }

    const draggedIndex = result.findIndex(
      (row) => row.kind === "item" && row.id === operation.draggedId,
    );
    const targetIndex = result.findIndex(
      (row) => row.kind === "item" && row.id === operation.targetId,
    );

    if (draggedIndex < 0 || targetIndex < 0) {
      continue;
    }

    const dragged = result[draggedIndex];
    const target = result[targetIndex];

    if (
      dragged?.kind !== "item" ||
      target?.kind !== "item" ||
      dragged.regionKey === null ||
      dragged.regionKey !== target.regionKey
    ) {
      continue;
    }

    result.splice(draggedIndex, 1);

    const currentTargetIndex = result.findIndex(
      (row) => row.kind === "item" && row.id === operation.targetId,
    );

    const insertionIndex =
      operation.placement === "before"
        ? currentTargetIndex
        : currentTargetIndex + 1;

    result.splice(insertionIndex, 0, dragged);
  }

  return result;
}

export function SelectedItemsResults({
  search,
  revision,
  selectionActionsDisabled,
  optimisticSelection,
  optimisticReorders,
  fallbackSnapshot,
  fallbackScrollOffsetRef,
  onInitialLoadSettled,
  onReconciled,
  onUnselect,
  onReorder,
  onPresentationSnapshot,
  onPresentationScroll,
}: SelectedItemsResultsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const anchorRef = useRef<{
    key: string;
    offset: number;
  } | null>(null);
  const snapshotScrollRestoredRef = useRef(false);

  const captureViewportRef = useRef<() => Set<string>>(() => new Set<string>());
  const captureViewport = useCallback(() => captureViewportRef.current(), []);
  const freshnessToken = `selected=${revision}`;
  const {
    pages,
    loading,
    error,
    initialized,
    loadPage,
    retry,
    touchPage,
    datasetVersion,
  } = useSelectedItems(search, freshnessToken, captureViewport);
  const showingSnapshot = !initialized && fallbackSnapshot !== null;

  const presentationPages: readonly CachedSelectedPage[] = showingSnapshot
    ? fallbackSnapshot.pages
    : pages;

  const presentationInitialized = initialized || showingSnapshot;

  const disabled = showingSnapshot || loading !== null || error !== null;

  //const disabled = loading !== null || error !== null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const [draggedId, setDraggedId] = useState<number | null>(null);

  const pendingReorderVersions = useMemo(
    () =>
      new Set(
        optimisticReorders.map((operation) => operation.baseServerVersion),
      ),
    [optimisticReorders],
  );

  const versionEligible =
    !showingSnapshot &&
    datasetVersion !== null &&
    [...pendingReorderVersions].every((version) => version === datasetVersion);

  const { rows, detachedPendingIds } = useMemo<{
    rows: VirtualRow[];
    detachedPendingIds: number[];
  }>(() => {
    const result: VirtualRow[] = [];
    const detached: number[] = [];
    let regionNumber = -1;
    let regionKey: string | null = null;

    for (const [pageIndex, page] of presentationPages.entries()) {
      const previous = presentationPages[pageIndex - 1];

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

        regionNumber++;
        regionKey = `region:${regionNumber}`;
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
          regionKey,
        });
      }
    }

    const lastPage = presentationPages[presentationPages.length - 1];

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
        presentationInitialized &&
        presentationPages.length === 0 &&
        result.length === 0;

      const lastItemRegion =
        [...result].reverse().find((row): row is ItemRow => row.kind === "item")
          ?.regionKey ?? null;

      if (endIndex >= 0) {
        result.splice(endIndex, 0, {
          kind: "item",
          key: `optimistic-item:${id}`,
          id,
          pageKey: null,
          optimistic: true,
          regionKey: lastItemRegion,
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
          regionKey: "region:optimistic-empty",
        });

        continue;
      }

      detached.push(id);
    }

    return {
      rows: applyOptimisticReorders(result, optimisticReorders, search),
      detachedPendingIds: detached,
    };
  }, [
    presentationPages,
    optimisticSelection,
    search,
    presentationInitialized,
    optimisticReorders,
  ]);

  const itemById = useMemo(
    () =>
      new Map(
        rows.flatMap((row) =>
          row.kind === "item" ? [[row.id, row] as const] : [],
        ),
      ),
    [rows],
  );

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

      if (!showingSnapshot && row.pageKey !== null) {
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

  useLayoutEffect(() => {
    if (showingSnapshot) {
      return;
    }

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
  }, [rows, rowVirtualizer, showingSnapshot]);

  useLayoutEffect(() => {
    if (
      !showingSnapshot ||
      fallbackSnapshot === null ||
      snapshotScrollRestoredRef.current
    ) {
      return;
    }

    snapshotScrollRestoredRef.current = true;

    rowVirtualizer.scrollToOffset(fallbackScrollOffsetRef.current, {
      behavior: "auto",
    });
  }, [
    showingSnapshot,
    fallbackSnapshot,
    rowVirtualizer,
    fallbackScrollOffsetRef,
  ]);

  useEffect(() => {
    if (!initialized || datasetVersion === null) {
      return;
    }

    onPresentationSnapshot(
      {
        search,
        revision,
        pages,
        datasetVersion,
      },
      rootRef.current?.scrollTop ?? 0,
    );
  }, [
    initialized,
    datasetVersion,
    search,
    revision,
    pages,
    onPresentationSnapshot,
  ]);

  useEffect(() => {
    if (showingSnapshot) {
      return;
    }

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
  }, [rows, virtualItems, touchPage, showingSnapshot]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = event.active.data.current?.id;
      const regionKey = event.active.data.current?.regionKey;

      if (
        typeof id !== "number" ||
        typeof regionKey !== "string" ||
        !versionEligible
      ) {
        setDraggedId(null);
        return;
      }

      setDraggedId(id);
    },
    [versionEligible],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggedId(null);

      if (datasetVersion === null || !versionEligible || event.over === null) {
        return;
      }

      const dragged = event.active.data.current;
      const target = event.over.data.current;

      if (
        typeof dragged?.id !== "number" ||
        typeof target?.id !== "number" ||
        dragged.id === target.id ||
        typeof dragged.regionKey !== "string" ||
        dragged.regionKey !== target.regionKey
      ) {
        return;
      }

      const draggedRow = itemById.get(dragged.id);
      const targetRow = itemById.get(target.id);

      if (
        draggedRow === undefined ||
        targetRow === undefined ||
        draggedRow.regionKey === null ||
        draggedRow.regionKey !== targetRow.regionKey
      ) {
        return;
      }

      const activeCenter =
        event.active.rect.current.translated === null
          ? null
          : event.active.rect.current.translated.top +
            event.active.rect.current.translated.height / 2;

      const overCenter = event.over.rect.top + event.over.rect.height / 2;

      if (activeCenter === null) {
        return;
      }

      onReorder({
        draggedId: dragged.id,
        targetId: target.id,
        placement: activeCenter < overCenter ? "before" : "after",
        search,
        baseServerVersion: datasetVersion,
      });
    },
    [datasetVersion, itemById, onReorder, search, versionEligible],
  );

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragCancel={() => {
          setDraggedId(null);
        }}
        onDragEnd={handleDragEnd}
      >
        <Box sx={{ p: 2, flexShrink: 0 }}>
          <Box
            sx={{
              minHeight: 48,
              display: "flex",
              alignItems: "center",
              minWidth: 0,
            }}
          >
            {error !== null ? (
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
            ) : loading !== null ? (
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
            ) : null}
          </Box>
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
                  <Button
                    size="small"
                    disabled={selectionActionsDisabled}
                    onClick={() => {
                      onUnselect(id);
                    }}
                  >
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
            height: { xs: 480, md: "auto" },
            flex: { md: "1 1 auto" },
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            overflowAnchor: "none",
            overscrollBehavior: "contain",
            scrollbarGutter: "stable",
            px: 2,
          }}
          onScroll={(event) => {
            onPresentationScroll(event.currentTarget.scrollTop);
          }}
        >
          {presentationInitialized &&
          rows.length === 0 &&
          detachedPendingIds.length === 0 ? (
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
                    data-selected-page-key={
                      row.kind === "item"
                        ? (row.pageKey ?? undefined)
                        : undefined
                    }
                  >
                    {row.kind === "item" && (
                      <SelectedItemRow
                        id={row.id}
                        regionKey={row.regionKey}
                        optimistic={row.optimistic}
                        dndDisabled={
                          !versionEligible ||
                          row.regionKey === null ||
                          (row.pageKey === null &&
                            !rows.some(
                              (candidate) =>
                                candidate.kind === "end" ||
                                (candidate.kind === "item" &&
                                  candidate.regionKey === row.regionKey &&
                                  candidate.pageKey !== null),
                            ))
                        }
                        selectionActionsDisabled={selectionActionsDisabled}
                        onUnselect={onUnselect}
                      />
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

        <DragOverlay>
          {draggedId === null ? null : (
            <Box
              sx={{
                px: 2,
                height: ROW_HEIGHT,
                display: "flex",
                alignItems: "center",
                bgcolor: "background.paper",
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                boxShadow: 3,
              }}
            >
              ID: {draggedId}
            </Box>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}
