import { useCallback, useState, useEffect, useRef } from "react";
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
import type {
  OptimisticSelectionOperation,
  SelectionAction,
} from "../types/selection";

import { ApiRequestError } from "../api/api-error";
import { selectItem, unselectItem } from "../api/selected-items.api";
import { AvailableItemsList } from "../components/AvailableItemsList";
import { SelectedItemsList } from "../components/SelectedItemsList";

export function InventoryPage() {
  const [selectedLoading, setSelectedLoading] = useState(true);
  const [optimisticSelection, setOptimisticSelection] = useState<
    Map<number, OptimisticSelectionOperation>
  >(() => new Map());
  const mutationInFlightRef = useRef(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [availableRevision, setAvailableRevision] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState(0);
  const mutationPending = optimisticSelection.size > 0;
  const selectionActionsDisabled = selectedLoading || mutationPending;

  useEffect(() => {
    mutationInFlightRef.current = optimisticSelection.size > 0;
  }, [optimisticSelection]);

  const handleAvailableReconciled = useCallback((revision: number) => {
    setOptimisticSelection((previous) => {
      let changed = false;
      const next = new Map(previous);

      for (const [id, operation] of next) {
        if (
          operation.phase !== "reconciling" ||
          operation.availableRevision !== revision ||
          operation.availableReconciled
        ) {
          continue;
        }

        const updatedOperation: OptimisticSelectionOperation = {
          ...operation,
          availableReconciled: true,
        };

        if (updatedOperation.selectedReconciled) {
          next.delete(id);
        } else {
          next.set(id, updatedOperation);
        }
        changed = true;
      }

      return changed ? next : previous;
    });
  }, []);

  const handleSelectedReconciled = useCallback((revision: number) => {
    setOptimisticSelection((previous) => {
      let changed = false;
      const next = new Map(previous);

      for (const [id, operation] of next) {
        if (
          operation.phase !== "reconciling" ||
          operation.selectedRevision !== revision ||
          operation.selectedReconciled
        ) {
          continue;
        }

        const updatedOperation: OptimisticSelectionOperation = {
          ...operation,
          selectedReconciled: true,
        };

        if (updatedOperation.availableReconciled) {
          next.delete(id);
        } else {
          next.set(id, updatedOperation);
        }

        changed = true;
      }

      return changed ? next : previous;
    });
  }, []);

  const applySelectionMutation = useCallback(
    async (
      id: number,
      action: SelectionAction,
      mutation: () => Promise<SelectionMutationResponse>,
    ) => {
      if (selectedLoading || mutationInFlightRef.current) {
        return;
      }

      mutationInFlightRef.current = true;
      setSelectionError(null);

      setOptimisticSelection((previous) => {
        const next = new Map(previous);

        next.set(id, {
          action,
          phase: "pending",
          availableRevision: null,
          selectedRevision: null,
          availableReconciled: false,
          selectedReconciled: false,
        });

        return next;
      });

      try {
        const response = await mutation();
        const expectedSelected = action === "select";

        if (response.id !== id || response.selected !== expectedSelected) {
          throw new ApiRequestError(
            "INVALID_RESPONSE",
            "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
          );
        }

        const nextAvailableRevision = availableRevision + 1;
        const nextSelectedRevision = selectedRevision + 1;

        setOptimisticSelection((previous) => {
          const operation = previous.get(id);

          if (operation === undefined) {
            return previous;
          }

          const next = new Map(previous);

          next.set(id, {
            ...operation,
            phase: "reconciling",
            availableRevision: nextAvailableRevision,
            selectedRevision: nextSelectedRevision,
            availableReconciled: false,
            selectedReconciled: false,
          });

          return next;
        });

        setSelectedLoading(true);
        setAvailableRevision(nextAvailableRevision);
        setSelectedRevision(nextSelectedRevision);
      } catch (error) {
        setOptimisticSelection((previous) => {
          if (!previous.has(id)) {
            return previous;
          }

          const next = new Map(previous);
          next.delete(id);
          return next;
        });

        mutationInFlightRef.current = false;

        setSelectionError(
          error instanceof ApiRequestError
            ? error.message
            : "Не удалось изменить выбор. Попробуйте снова.",
        );
      }
    },
    [selectedLoading, availableRevision, selectedRevision],
  );

  const handleSelectedInitialLoadSettled = useCallback(() => {
    setSelectedLoading(false);
  }, []);

  const handleSelect = useCallback(
    async (id: number) => {
      await applySelectionMutation(id, "select", () => selectItem(id));
    },
    [applySelectionMutation],
  );

  const handleUnselect = useCallback(
    async (id: number) => {
      await applySelectionMutation(id, "unselect", () => unselectItem(id));
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
            optimisticSelection={optimisticSelection}
            onReconciled={handleAvailableReconciled}
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
            selectedRevision={selectedRevision}
            mutationPending={selectionActionsDisabled}
            optimisticSelection={optimisticSelection}
            onInitialLoadSettled={handleSelectedInitialLoadSettled}
            onReconciled={handleSelectedReconciled}
            onUnselect={handleUnselect}
          />
        </Paper>
      </Stack>
    </Container>
  );
}
