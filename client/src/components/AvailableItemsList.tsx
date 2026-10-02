import { useState, useEffect } from "react";
import { Box, TextField } from "@mui/material";

import { AvailableItemsResults } from "./AvailableItemsResults";

type AvailableItemsListProps = {
  availableRevision: number;
  mutationPending: boolean;
  onSelect: (id: number) => Promise<void>;
};

const SEARCH_DEBOUNCE_MS = 300;

export function AvailableItemsList({
  availableRevision,
  mutationPending,
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
        key={JSON.stringify([search, availableRevision])}
        search={search}
        mutationPending={mutationPending}
        onSelect={onSelect}
      />
    </>
  );
}
