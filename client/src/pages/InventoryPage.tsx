import { useCallback, useState } from "react";
import {
  Box,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
  Alert,
} from "@mui/material";

import type { SelectionMutationResponse } from "@inventory/shared";

import { ApiRequestError } from "../api/api-error";
import { selectItem, unselectItem } from "../api/selected-items.api";
import { AvailableItemsList } from "../components/AvailableItemsList";
import { SelectedItemsList } from "../components/SelectedItemsList";

export function InventoryPage() {
  const [selectedLoading, setSelectedLoading] = useState(true);
  const [mutationPending, setMutationPending] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [availableRevision, setAvailableRevision] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState(0);
  const selectionActionsDisabled = selectedLoading || mutationPending;

  const applySelectionMutation = useCallback(
    async (mutation: () => Promise<SelectionMutationResponse>) => {
      if (selectedLoading || mutationPending) {
        return;
      }

      setMutationPending(true);
      setSelectionError(null);

      try {
        await mutation();
        setSelectedLoading(true);

        setAvailableRevision((revision) => revision + 1);
        setSelectedRevision((revision) => revision + 1);
      } catch (error) {
        setSelectionError(
          error instanceof ApiRequestError
            ? error.message
            : "Не удалось изменить выбор. Попробуйте снова.",
        );
      } finally {
        setMutationPending(false);
      }
    },
    [selectedLoading, mutationPending],
  );

  const handleSelectedInitialLoadSettled = useCallback(() => {
    setSelectedLoading(false);
  }, []);

  const handleSelect = useCallback(
    async (id: number) => {
      await applySelectionMutation(() => selectItem(id));
    },
    [applySelectionMutation],
  );

  const handleUnselect = useCallback(
    async (id: number) => {
      await applySelectionMutation(() => unselectItem(id));
    },
    [applySelectionMutation],
  );

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
          <AvailableItemsList
            availableRevision={availableRevision}
            mutationPending={selectionActionsDisabled}
            onSelect={handleSelect}
          />
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

          {selectionError !== null && (
            <Box sx={{ px: 2, pt: 2 }}>
              <Alert severity="error">{selectionError}</Alert>
            </Box>
          )}

          <SelectedItemsList
            key={selectedRevision}
            mutationPending={selectionActionsDisabled}
            onInitialLoadSettled={handleSelectedInitialLoadSettled}
            onUnselect={handleUnselect}
          />
        </Paper>
      </Stack>
    </Container>
  );
}
