import { useCallback, useState } from "react";
import {
  Box,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
  Alert,
  Button,
} from "@mui/material";

import { useSelectionMutationQueue } from "../hooks/useSelectionMutationQueue";
import { useAddItemsMutationQueue } from "../hooks/useAddItemsMutationQueue";
import { AddItemForm } from "../components/AddItemForm";
import { AvailableItemsList } from "../components/AvailableItemsList";
import { SelectedItemsList } from "../components/SelectedItemsList";

export function InventoryPage() {
  const [selectedLoading, setSelectedLoading] = useState(true);
  const {
    optimisticSelection,
    availableRevision: selectionAvailableRevision,
    selectedRevision,
    error: selectionError,
    queueSelection,
    retry: retrySelectionBatch,
    confirmAvailableRevision: confirmSelectionAvailableRevision,
    confirmSelectedRevision,
    optimisticReorders,
    queueReorder,
  } = useSelectionMutationQueue();
  const {
    pendingAdditions,
    availableRevision: additionAvailableRevision,
    error: additionError,
    queueAddition,
    retry: retryAdditionBatch,
    confirmAvailableRevision: confirmAdditionAvailableRevision,
  } = useAddItemsMutationQueue();
  const selectionActionsDisabled = selectedLoading;

  const handleSelectedInitialLoadSettled = useCallback(() => {
    setSelectedLoading(false);
  }, []);

  const handleReorder = useCallback(
    (input: {
      draggedId: number;
      targetId: number;
      placement: "before" | "after";
      search: string;
      baseServerVersion: number;
    }) => queueReorder(input),
    [queueReorder],
  );

  const handleSelect = useCallback(
    (id: number) => {
      if (selectedLoading) {
        return;
      }

      queueSelection(id, true);
    },
    [selectedLoading, queueSelection],
  );

  const handleUnselect = useCallback(
    (id: number) => {
      if (selectedLoading) {
        return;
      }

      queueSelection(id, false);
    },
    [selectedLoading, queueSelection],
  );

  const handleAvailableReconciled = useCallback(
    (
      reconciledSelectionRevision: number,
      reconciledAdditionRevision: number,
    ) => {
      confirmSelectionAvailableRevision(reconciledSelectionRevision);
      confirmAdditionAvailableRevision(reconciledAdditionRevision);
    },
    [confirmSelectionAvailableRevision, confirmAdditionAvailableRevision],
  );

  return (
    <Container
      component="main"
      maxWidth="lg"
      sx={{
        height: { xs: "auto", md: "100%" },
        minHeight: { xs: "100dvh", md: 0 },
        py: 4,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        overflow: { xs: "visible", md: "hidden" },
      }}
    >
      <Typography
        component="h1"
        variant="h4"
        sx={{ mb: 3, fontWeight: 600, flexShrink: 0 }}
      >
        Управление элементами
      </Typography>

      <Box sx={{ p: 2, flexShrink: 0 }}>
        <Typography id="available-items-heading" component="h2" variant="h6">
          Доступные элементы
        </Typography>
        <AddItemForm onAdd={queueAddition} />
      </Box>

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={3}
        sx={{
          flex: { md: "1 1 auto" },
          minHeight: { md: 0 },
          overflow: { xs: "visible", md: "hidden" },
          alignItems: "stretch",
        }}
      >
        <Paper
          component="section"
          variant="outlined"
          aria-labelledby="available-items-heading"
          sx={{
            flex: { md: "1 1 0" },
            minWidth: 0,
            minHeight: { xs: 320, md: 0 },
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Box sx={{ p: 2, flexShrink: 0 }}>
            <Typography
              id="available-items-heading"
              component="h2"
              variant="h6"
            >
              Доступные элементы
            </Typography>
          </Box>

          <Divider />

          {additionError !== null && (
            <Box sx={{ px: 2, pt: 2, flexShrink: 0 }}>
              <Alert
                severity="error"
                action={
                  additionError.retryable ? (
                    <Button color="inherit" onClick={retryAdditionBatch}>
                      Повторить
                    </Button>
                  ) : undefined
                }
              >
                {additionError.message}
              </Alert>
            </Box>
          )}

          <AvailableItemsList
            selectionAvailableRevision={selectionAvailableRevision}
            additionAvailableRevision={additionAvailableRevision}
            selectionActionsDisabled={selectionActionsDisabled}
            optimisticSelection={optimisticSelection}
            pendingAdditions={pendingAdditions}
            onReconciled={handleAvailableReconciled}
            onSelect={handleSelect}
          />
        </Paper>

        <Paper
          component="section"
          variant="outlined"
          aria-labelledby="selected-items-heading"
          sx={{
            flex: { md: "1 1 0" },
            minWidth: 0,
            minHeight: { xs: 320, md: 0 },
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Box sx={{ p: 2, flexShrink: 0 }}>
            <Typography id="selected-items-heading" component="h2" variant="h6">
              Выбранные элементы
            </Typography>
          </Box>

          <Divider />

          {selectionError !== null && (
            <Box sx={{ px: 2, pt: 2, flexShrink: 0 }}>
              <Alert
                severity="error"
                action={
                  selectionError.retryable ? (
                    <Button color="inherit" onClick={retrySelectionBatch}>
                      Повторить
                    </Button>
                  ) : undefined
                }
              >
                {selectionError.message}
              </Alert>
            </Box>
          )}

          <SelectedItemsList
            selectedRevision={selectedRevision}
            selectionActionsDisabled={selectionActionsDisabled}
            optimisticSelection={optimisticSelection}
            onInitialLoadSettled={handleSelectedInitialLoadSettled}
            onReconciled={confirmSelectedRevision}
            onUnselect={handleUnselect}
            optimisticReorders={optimisticReorders}
            onReorder={handleReorder}
          />
        </Paper>
      </Stack>
    </Container>
  );
}
