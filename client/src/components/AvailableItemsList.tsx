import { useState } from "react";
import { Box, TextField } from "@mui/material";

import { AvailableItemsResults } from "./AvailableItemsResults";

export function AvailableItemsList() {
  const [search, setSearch] = useState("");

  return (
    <>
      <Box sx={{ px: 2, pt: 2 }}>
        <TextField
          fullWidth
          size="small"
          label="Поиск по ID"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
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
