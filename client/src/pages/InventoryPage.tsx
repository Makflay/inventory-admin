import { useEffect, useRef } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Divider,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
  Button,
} from "@mui/material";

import { useAvailableItems } from "../hooks/useAvailableItems";

export function InventoryPage() {
  const { pages, isLoading, error, hasMore, loadNextPage, retry } =
    useAvailableItems();

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const hasLoadedPages = pages.length > 0;
  const loadedCount = pages.reduce(
    (total, page) => total + page.data.ids.length,
    0,
  );

  useEffect(() => {
    if (!hasLoadedPages || isLoading || error !== null || !hasMore) {
      return;
    }

    const root = scrollContainerRef.current;
    const sentinel = sentinelRef.current;

    if (root === null || sentinel === null) {
      return;
    }

    let active = true;

    const observer = new IntersectionObserver(
      (entries) => {
        if (active && entries.some((entry) => entry.isIntersecting)) {
          loadNextPage();
        }
      },
      {
        root,
        rootMargin: "0px 0px 160px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      active = false;
      observer.disconnect();
    };
  }, [hasLoadedPages, isLoading, error, hasMore, loadNextPage]);

  return (
    <Container component="main" maxWidth="lg" sx={{ py: 4 }}>
      <Typography component="h1" variant="h4" sx={{ mb: 3, fontWeight: 600 }}>
        Управление элементами
      </Typography>

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={3}
        sx={{ alignItems: "stretch" }}
      >
        <Paper
          component="section"
          variant="outlined"
          aria-labelledby="available-items-heading"
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 320,
            overflow: "hidden",
          }}
        >
          <Box sx={{ p: 2 }}>
            <Typography
              id="available-items-heading"
              component="h2"
              variant="h6"
            >
              Доступные элементы
            </Typography>

            <Typography variant="body2" color="text.secondary">
              Загружено: {loadedCount}
            </Typography>
          </Box>

          <Divider />

          <Box
            ref={scrollContainerRef}
            role="region"
            aria-labelledby="available-items-heading"
            aria-busy={isLoading}
            tabIndex={0}
            sx={{
              height: 480,
              overflowY: "auto",
              overscrollBehavior: "contain",
              scrollbarGutter: "stable",
              p: 2,
            }}
          >
            {loadedCount > 0 && (
              <List disablePadding aria-labelledby="available-items-heading">
                {pages.map((page) =>
                  page.data.ids.map((id) => (
                    <ListItem key={id} divider>
                      <ListItemText primary={`ID: ${id}`} />
                    </ListItem>
                  )),
                )}
              </List>
            )}

            {hasLoadedPages && loadedCount === 0 && (
              <Typography color="text.secondary">
                Нет доступных элементов.
              </Typography>
            )}

            {isLoading && (
              <Stack
                role="status"
                direction="row"
                spacing={2}
                sx={{ py: 2, alignItems: "center" }}
              >
                <CircularProgress size={24} aria-hidden="true" />

                <Typography>
                  {hasLoadedPages
                    ? "Загрузка следующих элементов…"
                    : "Загрузка элементов…"}
                </Typography>
              </Stack>
            )}

            {error !== null && (
              <Alert
                severity="error"
                sx={{ my: 2 }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={retry}
                    disabled={isLoading}
                  >
                    Повторить
                  </Button>
                }
              >
                {error}
              </Alert>
            )}

            {hasLoadedPages && !hasMore && loadedCount > 0 && (
              <Typography
                role="status"
                variant="body2"
                color="text.secondary"
                sx={{ py: 2 }}
              >
                Все доступные элементы загружены.
              </Typography>
            )}

            <Box ref={sentinelRef} aria-hidden="true" sx={{ height: 1 }} />
          </Box>
        </Paper>

        <Paper
          component="section"
          variant="outlined"
          aria-labelledby="selected-items-heading"
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 320,
            overflow: "hidden",
          }}
        >
          <Box sx={{ p: 2 }}>
            <Typography id="selected-items-heading" component="h2" variant="h6">
              Выбранные элементы
            </Typography>
          </Box>

          <Divider />

          <Box sx={{ p: 2 }}>
            <Typography color="text.secondary">
              Здесь будут отображаться выбранные элементы.
            </Typography>
          </Box>
        </Paper>
      </Stack>
    </Container>
  );
}
