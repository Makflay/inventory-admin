import { useState, useEffect } from "react";
import { Box, TextField } from "@mui/material";

import type { OptimisticSelection } from "../types/selection";

import { SelectedItemsResults } from "./SelectedItemsResults";

const SEARCH_DEBOUNCE_MS = 300;

type SelectedItemsListProps = {
  selectedRevision: number;
  selectionActionsDisabled: boolean;
  optimisticSelection: OptimisticSelection;
  onInitialLoadSettled: () => void;
  onReconciled: (revision: number) => void;
  onUnselect: (id: number) => void;
};

export function SelectedItemsList({
  selectedRevision,
  selectionActionsDisabled,
  optimisticSelection,
  onInitialLoadSettled,
  onReconciled,
  onUnselect,
}: SelectedItemsListProps) {
  const [inputValue, setInputValue] = useState("");
  const [search, setSearch] = useState("");

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
      <Box sx={{ p: 2, pt: 2 }}>
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

      <SelectedItemsResults
        key={JSON.stringify([search, selectedRevision])}
        search={search}
        revision={selectedRevision}
        selectionActionsDisabled={selectionActionsDisabled}
        optimisticSelection={optimisticSelection}
        onInitialLoadSettled={onInitialLoadSettled}
        onReconciled={onReconciled}
        onUnselect={onUnselect}
      />
    </>
  );
}
