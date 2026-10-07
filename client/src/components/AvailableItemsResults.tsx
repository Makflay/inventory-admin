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
import type { OptimisticSelection } from "../types/selection";
import type { PendingAdditions } from "../types/add-items";
import type { CachedPage } from "../services/available-items-cache";

import { useAvailableItems } from "../hooks/useAvailableItems";
import { buildAvailablePresentation } from "../presentation/available-items-presentation";

const ROW_HEIGHT = 48;
const OVERSCAN = 8;

type BoundaryProps = {
  rootRef: RefObject<HTMLDivElement | null>;
  before: string | null;
  after: string | null;
  disabled: boolean;
  search: string;
  onLoad: (request: AvailableItemsPageRequest) => void;
};

type AvailableItemsResultsProps = {
  search: string;
  selectionRevision: number;
  additionRevision: number;
  selectionActionsDisabled: boolean;
  optimisticSelection: OptimisticSelection;
  pendingAdditions: PendingAdditions;
  fallbackSnapshot: AvailablePresentationSnapshot | null;
  fallbackScrollOffsetRef: RefObject<number>;
  onReconciled: (selectionRevision: number, additionRevision: number) => void;
  onSelect: (id: number) => void;
  onPresentationSnapshot: (
    snapshot: AvailablePresentationSnapshot,
    scrollOffset: number,
  ) => void;
  onPresentationScroll: (scrollOffset: number) => void;
};

export type AvailablePresentationSnapshot = {
  search: string;
  selectionRevision: number;
  additionRevision: number;
  pages: readonly CachedPage[];
};

function LoadBoundary({
  rootRef,
  before,
  after,
  disabled,
  search,
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
          onLoad({ search, before });
        } else if (after !== null) {
          onLoad({ search, after });
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
  }, [rootRef, before, after, disabled, search, onLoad]);

  return <Box ref={markerRef} aria-hidden="true" sx={{ height: ROW_HEIGHT }} />;
}

export function AvailableItemsResults({
  search,
  selectionRevision,
  additionRevision,
  selectionActionsDisabled,
  optimisticSelection,
  pendingAdditions,
  fallbackSnapshot,
  fallbackScrollOffsetRef,
  onReconciled,
  onSelect,
  onPresentationSnapshot,
  onPresentationScroll,
}: AvailableItemsResultsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<{
    key: string;
    offset: number;
  } | null>(null);
  const snapshotScrollRestoredRef = useRef(false);

  const captureViewportRef = useRef<() => Set<string>>(() => new Set<string>());
  const captureViewport = useCallback(() => captureViewportRef.current(), []);
  const freshnessToken = `selection=${selectionRevision};addition=${additionRevision}`;

  const { pages, loading, error, initialized, loadPage, retry, touchPage } =
    useAvailableItems(search, freshnessToken, captureViewport);

  const showingSnapshot = !initialized && fallbackSnapshot !== null;

  const presentationPages: readonly CachedPage[] = showingSnapshot
    ? fallbackSnapshot.pages
    : pages;

  const presentationInitialized = initialized || showingSnapshot;

  const disabled = showingSnapshot || loading !== null || error !== null;
  const count = presentationPages.reduce(
    (total, page) => total + page.data.ids.length,
    0,
  );

  const { rows, detachedPendingRows } = useMemo(
    () =>
      buildAvailablePresentation({
        pages: presentationPages,
        optimisticSelection,
        pendingAdditions,
        search,
        initialized: presentationInitialized,
      }),
    [
      presentationPages,
      optimisticSelection,
      pendingAdditions,
      search,
      presentationInitialized,
    ],
  );

  const getItemKey = useCallback(
    (index: number) => rows[index]?.key ?? index,
    [rows],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
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
    fallbackScrollOffsetRef,
    rowVirtualizer,
  ]);

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
    if (!initialized) {
      return;
    }

    onPresentationSnapshot(
      {
        search,
        selectionRevision,
        additionRevision,
        pages,
      },
      rootRef.current?.scrollTop ?? 0,
    );
  }, [
    initialized,
    search,
    selectionRevision,
    additionRevision,
    pages,
    onPresentationSnapshot,
  ]);

  useEffect(() => {
    if (initialized) {
      onReconciled(selectionRevision, additionRevision);
    }
  }, [initialized, selectionRevision, additionRevision, onReconciled]);

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

  return (
    <>
      <Box sx={{ p: 2, flexShrink: 0 }}>
        <Typography variant="body2" color="text.secondary">
          Доступно без загрузки: {count}
        </Typography>

        <Box
          sx={{
            minHeight: 48,
            mt: 1,
            display: "flex",
            alignItems: "center",
            minWidth: 0,
          }}
        >
          {error !== null ? (
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
          ) : loading !== null ? (
            <Stack
              direction="row"
              spacing={1}
              role="status"
              sx={{ mt: 1, alignItems: "center" }}
            >
              <CircularProgress
                size={20}
                aria-hidden="true"
                sx={{ flexShrink: 0 }}
              />
              <Typography variant="body2" noWrap>
                {initialized
                  ? "Загружаем ещё элементы…"
                  : "Загрузка элементов…"}
              </Typography>
            </Stack>
          ) : null}
        </Box>
      </Box>

      {detachedPendingRows.length > 0 && (
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
          {detachedPendingRows.map(({ id, source }) => {
            const pendingAddition = source === "addition";

            return (
              <ListItem
                key={`detached-pending:${source}:${id}`}
                component="div"
                role="listitem"
                data-pending-item-id={id}
                secondaryAction={
                  <Button
                    size="small"
                    disabled={selectionActionsDisabled || pendingAddition}
                    onClick={() => {
                      onSelect(id);
                    }}
                  >
                    Выбрать
                  </Button>
                }
                sx={{
                  minHeight: ROW_HEIGHT,
                  boxSizing: "border-box",
                }}
              >
                <ListItemText primary={`ID: ${id}`} secondary="Сохранение…" />
              </ListItem>
            );
          })}
        </Box>
      )}

      <Box
        ref={rootRef}
        role="region"
        aria-labelledby="available-items-heading"
        data-available-items-scroll
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
        detachedPendingRows.length === 0 ? (
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
                      data-page-key={row.pageKey ?? undefined}
                      divider
                      secondaryAction={
                        <Button
                          size="small"
                          disabled={
                            selectionActionsDisabled || row.pendingAddition
                          }
                          onClick={() => {
                            void onSelect(row.id);
                          }}
                        >
                          Выбрать
                        </Button>
                      }
                      sx={{
                        height: ROW_HEIGHT,
                        boxSizing: "border-box",
                      }}
                    >
                      <ListItemText
                        primary={`ID: ${row.id}`}
                        secondary={
                          row.optimistic || row.pendingAddition
                            ? "Сохранение…"
                            : undefined
                        }
                      />
                    </ListItem>
                  )}

                  {row.kind === "boundary" && (
                    <LoadBoundary
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
