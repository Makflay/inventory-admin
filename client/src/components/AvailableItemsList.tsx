import { useState, useEffect } from "react";
import { Box, TextField } from "@mui/material";

import type { OptimisticSelection } from "../types/selection";
import type { PendingAdditions } from "../types/add-items";

import { AvailableItemsResults } from "./AvailableItemsResults";

type AvailableItemsListProps = {
  selectionAvailableRevision: number;
  additionAvailableRevision: number;
  selectionActionsDisabled: boolean;
  optimisticSelection: OptimisticSelection;
  pendingAdditions: PendingAdditions;
  onReconciled: (selectionRevision: number, additionRevision: number) => void;
  onSelect: (id: number) => void;
};

const SEARCH_DEBOUNCE_MS = 300;

export function AvailableItemsList({
  selectionAvailableRevision,
  additionAvailableRevision,
  selectionActionsDisabled,
  optimisticSelection,
  pendingAdditions,
  onReconciled,
  onSelect,
}: AvailableItemsListProps) {
  const [search, setSearch] = useState("");
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    if (inputValue === search) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSearch(inputValue);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [inputValue, search]);

  return (
    <>
      <Box sx={{ px: 2, pt: 2 }}>
        <TextField
          fullWidth
          size="small"
          label="Поиск по ID"
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
          }}
          slotProps={{
            htmlInput: {
              inputMode: "numeric",
              autoComplete: "off",
            },
          }}
        />
      </Box>

      <AvailableItemsResults
        key={JSON.stringify([
          search,
          selectionAvailableRevision,
          additionAvailableRevision,
        ])}
        search={search}
        selectionRevision={selectionAvailableRevision}
        additionRevision={additionAvailableRevision}
        selectionActionsDisabled={selectionActionsDisabled}
        optimisticSelection={optimisticSelection}
        pendingAdditions={pendingAdditions}
        onReconciled={onReconciled}
        onSelect={onSelect}
      />
    </>
  );
}
