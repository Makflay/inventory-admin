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
} from "@mui/material";

import { useAvailableItems } from "../hooks/useAvailableItems";

export function InventoryPage() {
  const availableItems = useAvailableItems();

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

            {availableItems.status === "success" && (
              <Typography variant="body2" color="text.secondary">
                Загружено: {availableItems.page.ids.length}
              </Typography>
            )}
          </Box>

          <Divider />

          <Box aria-busy={availableItems.status === "loading"} sx={{ p: 2 }}>
            {availableItems.status === "loading" && (
              <Stack
                role="status"
                direction="row"
                spacing={2}
                sx={{ py: 2, alignItems: "center" }}
              >
                <CircularProgress size={24} aria-hidden="true" />
                <Typography>Загрузка элементов…</Typography>
              </Stack>
            )}

            {availableItems.status === "error" && (
              <Alert severity="error">{availableItems.message}</Alert>
            )}

            {availableItems.status === "success" &&
              (availableItems.page.ids.length === 0 ? (
                <Typography color="text.secondary">
                  Нет доступных элементов.
                </Typography>
              ) : (
                <List disablePadding aria-labelledby="available-items-heading">
                  {availableItems.page.ids.map((id) => (
                    <ListItem key={id} divider>
                      <ListItemText primary={`ID: ${id}`} />
                    </ListItem>
                  ))}
                </List>
              ))}
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
