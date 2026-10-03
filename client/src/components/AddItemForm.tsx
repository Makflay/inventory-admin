import { useState } from "react";
import { Button, Stack, TextField } from "@mui/material";

type AddItemFormProps = {
  onAdd: (id: number) => "queued" | "already-pending";
};

const POSITIVE_ID_PATTERN = /^[1-9]\d*$/;

export function AddItemForm({ onAdd }: AddItemFormProps) {
  const [inputValue, setInputValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!POSITIVE_ID_PATTERN.test(inputValue)) {
      setErrorMessage("Введите положительный ID без ведущих нулей.");
      return;
    }

    const id = Number(inputValue);

    if (!Number.isSafeInteger(id)) {
      setErrorMessage("Введите ID допустимого размера.");
      return;
    }

    const result = onAdd(id);

    if (result === "already-pending") {
      setErrorMessage("Этот ID уже ожидает добавления.");
      return;
    }

    setInputValue("");
    setErrorMessage(null);
  };

  return (
    <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: "flex-start" }}>
      <TextField
        fullWidth
        size="small"
        label="Новый ID"
        value={inputValue}
        error={errorMessage !== null}
        helperText={errorMessage}
        onChange={(event) => {
          setInputValue(event.target.value);
          setErrorMessage(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            handleSubmit();
          }
        }}
        slotProps={{
          htmlInput: {
            inputMode: "numeric",
            autoComplete: "off",
          },
        }}
      />

      <Button
        variant="contained"
        onClick={handleSubmit}
        disabled={inputValue.length === 0}
      >
        Добавить
      </Button>
    </Stack>
  );
}
