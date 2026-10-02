import {
  Box,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

import { AvailableItemsList } from "../components/AvailableItemsList";

export function InventoryPage() {
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
          sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}
        >
          <Box sx={{ p: 2 }}>
            <Typography
              id="available-items-heading"
              component="h2"
              variant="h6"
            >
              Доступные элементы
            </Typography>
          </Box>

          <Divider />
          <AvailableItemsList />
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
