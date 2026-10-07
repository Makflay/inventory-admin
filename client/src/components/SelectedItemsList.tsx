import { useState, useEffect, useCallback, useRef } from "react";
import { Box, TextField } from "@mui/material";

import type {
  OptimisticSelection,
  OptimisticReorderOperation,
  QueueReorderInput,
} from "../types/selection";
import type { SelectedPresentationSnapshot } from "./SelectedItemsResults";

import { SelectedItemsResults } from "./SelectedItemsResults";

const SEARCH_DEBOUNCE_MS = 300;

type SelectedItemsListProps = {
  selectedRevision: number;
  selectionActionsDisabled: boolean;
  optimisticSelection: OptimisticSelection;
  optimisticReorders: readonly OptimisticReorderOperation[];
  onInitialLoadSettled: () => void;
  onReconciled: (revision: number) => void;
  onUnselect: (id: number) => void;
  onReorder: (input: QueueReorderInput) => boolean;
};

export function SelectedItemsList({
  selectedRevision,
  selectionActionsDisabled,
  optimisticSelection,
  optimisticReorders,
  onInitialLoadSettled,
  onReconciled,
  onUnselect,
  onReorder,
}: SelectedItemsListProps) {
  const [inputValue, setInputValue] = useState("");
  const [search, setSearch] = useState("");
  const [presentationSnapshot, setPresentationSnapshot] =
    useState<SelectedPresentationSnapshot | null>(null);

  const presentationScrollOffsetRef = useRef(0);

  const handlePresentationSnapshot = useCallback(
    (snapshot: SelectedPresentationSnapshot, scrollOffset: number) => {
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
    presentationSnapshot.revision !== selectedRevision
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
        fallbackSnapshot={fallbackSnapshot}
        fallbackScrollOffsetRef={presentationScrollOffsetRef}
        onPresentationSnapshot={handlePresentationSnapshot}
        onPresentationScroll={handlePresentationScroll}
        optimisticSelection={optimisticSelection}
        optimisticReorders={optimisticReorders}
        onInitialLoadSettled={onInitialLoadSettled}
        onReconciled={onReconciled}
        onUnselect={onUnselect}
        onReorder={onReorder}
      />
    </Box>
  );
}
