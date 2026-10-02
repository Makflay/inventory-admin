import { useState, useEffect } from "react";
import { Box, TextField } from "@mui/material";

import { AvailableItemsResults } from "./AvailableItemsResults";

const SEARCH_DEBOUNCE_MS = 300;

export function AvailableItemsList() {
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
          value={search}
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

      <AvailableItemsResults key={search} search={search} />
    </>
  );
}
