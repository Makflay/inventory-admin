import { useState, useEffect, useCallback, useRef } from "react";
import { Box, TextField } from "@mui/material";

import type { OptimisticSelection } from "../types/selection";
import type { PendingAdditions } from "../types/add-items";
import type { AvailablePresentationSnapshot } from "./AvailableItemsResults";

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
  const [presentationSnapshot, setPresentationSnapshot] =
    useState<AvailablePresentationSnapshot | null>(null);

  const presentationScrollOffsetRef = useRef(0);

  const handlePresentationSnapshot = useCallback(
    (snapshot: AvailablePresentationSnapshot, scrollOffset: number) => {
      presentationScrollOffsetRef.current = scrollOffset;
      setPresentationSnapshot(snapshot);
    },
    [],
  );

  const handlePresentationScroll = useCallback((scrollOffset: number) => {
    presentationScrollOffsetRef.current = scrollOffset;
  }, []);

  const fallbackSnapshot =
    presentationSnapshot !== null &&
    presentationSnapshot.search === search &&
    (presentationSnapshot.selectionRevision !== selectionAvailableRevision ||
      presentationSnapshot.additionRevision !== additionAvailableRevision)
      ? presentationSnapshot
      : null;

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
    <Box
      sx={{
        flex: "1 1 auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ px: 2, pt: 2, flexShrink: 0 }}>
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
        fallbackSnapshot={fallbackSnapshot}
        fallbackScrollOffsetRef={presentationScrollOffsetRef}
        selectionActionsDisabled={selectionActionsDisabled}
        optimisticSelection={optimisticSelection}
        pendingAdditions={pendingAdditions}
        onPresentationSnapshot={handlePresentationSnapshot}
        onPresentationScroll={handlePresentationScroll}
        onReconciled={onReconciled}
        onSelect={onSelect}
      />
    </Box>
  );
}
