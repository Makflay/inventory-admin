import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
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

import { useSelectedItems } from "../hooks/useSelectedItems";
import { areSelectedPagesAdjacent } from "../services/selected-items-cache";

import { SelectedItemsLoadBoundary } from "./SelectedItemsLoadBoundary";

type SelectedItemsListProps = {
  mutationPending: boolean;
  onInitialLoadSettled: () => void;
  onUnselect: (id: number) => Promise<void>;
};

export function SelectedItemsList({
  mutationPending,
  onInitialLoadSettled,
  onUnselect,
}: SelectedItemsListProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const anchorRef = useRef<{
    id: string;
    offset: number;
  } | null>(null);

  const captureViewport = useCallback(() => {
    const root = rootRef.current;
    const visibleKeys = new Set<string>();

    anchorRef.current = null;

    if (root === null) {
      return visibleKeys;
    }

    const top = root.getBoundingClientRect().top + root.clientTop;
    const bottom = top + root.clientHeight;

    const blocks = root.querySelectorAll<HTMLElement>(
      "[data-selected-page-key]",
    );

    for (const block of blocks) {
      const rect = block.getBoundingClientRect();

      if (rect.bottom <= top || rect.top >= bottom) {
        continue;
      }

      const key = block.dataset.selectedPageKey;

      if (key !== undefined) {
        visibleKeys.add(key);
      }

      if (anchorRef.current !== null) {
        continue;
      }

      const rows = block.querySelectorAll<HTMLElement>(
        "[data-selected-item-id]",
      );

      for (const row of rows) {
        const rowRect = row.getBoundingClientRect();

        if (rowRect.bottom > top && rowRect.top < bottom) {
          anchorRef.current = {
            id: row.dataset.selectedItemId!,
            offset: rowRect.top - top,
          };
          break;
        }
      }
    }

    return visibleKeys;
  }, []);

  const { pages, loading, error, initialized, loadPage, retry, touchPage } =
    useSelectedItems(captureViewport);

  const disabled = loading !== null || error !== null;

  useEffect(() => {
    if (initialized || error !== null) {
      onInitialLoadSettled();
    }
  }, [initialized, error, onInitialLoadSettled]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const anchor = anchorRef.current;

    anchorRef.current = null;

    if (root === null || anchor === null) {
      return;
    }

    const row = root.querySelector<HTMLElement>(
      `[data-selected-item-id="${anchor.id}"]`,
    );

    if (row === null) {
      return;
    }

    const top = root.getBoundingClientRect().top + root.clientTop;

    const offset = row.getBoundingClientRect().top - top;

    root.scrollTop += offset - anchor.offset;
  }, [pages]);

  useEffect(() => {
    const root = rootRef.current;

    if (root === null) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          const key = (entry.target as HTMLElement).dataset.selectedPageKey;

          if (key !== undefined) {
            touchPage(key);
          }
        }
      },
      { root },
    );

    for (const block of root.querySelectorAll("[data-selected-page-key]")) {
      observer.observe(block);
    }

    return () => observer.disconnect();
  }, [pages, touchPage]);

  const lastPage = pages[pages.length - 1];

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

      <Box
        ref={rootRef}
        role="region"
        aria-labelledby="selected-items-heading"
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
            Список выбранных элементов пуст.
          </Typography>
        )}

        {pages.map((page, index) => {
          const previous = pages[index - 1];

          const hasGap =
            previous !== undefined && !areSelectedPagesAdjacent(previous, page);

          return (
            <Fragment key={page.key}>
              {(index === 0 || hasGap) && (
                <SelectedItemsLoadBoundary
                  rootRef={rootRef}
                  before={
                    page.data.pageInfo.hasPreviousPage
                      ? page.data.pageInfo.startCursor
                      : null
                  }
                  after={
                    hasGap &&
                    previous !== undefined &&
                    previous.data.pageInfo.hasNextPage
                      ? previous.data.pageInfo.endCursor
                      : null
                  }
                  disabled={disabled}
                  onLoad={loadPage}
                />
              )}

              <Box
                component="ul"
                data-selected-page-key={page.key}
                aria-labelledby="selected-items-heading"
                sx={{
                  m: 0,
                  p: 0,
                  listStyle: "none",
                }}
              >
                {page.data.ids.map((id) => (
                  <ListItem
                    key={id}
                    data-selected-item-id={id}
                    divider
                    secondaryAction={
                      <Button
                        size="small"
                        disabled={mutationPending}
                        onClick={() => {
                          void onUnselect(id);
                        }}
                      >
                        Убрать
                      </Button>
                    }
                  >
                    <ListItemText primary={`ID: ${id}`} />
                  </ListItem>
                ))}
              </Box>
            </Fragment>
          );
        })}

        {lastPage !== undefined &&
          (lastPage.data.pageInfo.hasNextPage ? (
            <SelectedItemsLoadBoundary
              rootRef={rootRef}
              before={null}
              after={lastPage.data.pageInfo.endCursor}
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
