import {
  Alert,
  Box,
  Button,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";

type SelectedItemsListProps = {
  ids: number[];
  loading: boolean;
  mutationPending: boolean;
  error: string | null;
  onUnselect: (id: number) => Promise<void>;
};

export function SelectedItemsList({
  ids,
  loading,
  mutationPending,
  error,
  onUnselect,
}: SelectedItemsListProps) {
  return (
    <Box sx={{ p: 2 }}>
      {loading && (
        <Stack
          direction="row"
          spacing={1}
          role="status"
          sx={{ alignItems: "center" }}
        >
          <CircularProgress size={20} aria-hidden="true" />
          <Typography variant="body2">Загрузка выбранных элементов…</Typography>
        </Stack>
      )}

      {error !== null && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!loading && ids.length === 0 && (
        <Typography color="text.secondary">
          Список выбранных элементов пуст.
        </Typography>
      )}

      <List disablePadding>
        {ids.map((id) => (
          <ListItem
            key={id}
            divider
            secondaryAction={
              <Button
                size="small"
                disabled={mutationPending}
                onClick={() => {
                  void onUnselect(id);
                }}
              >
                Убрать
              </Button>
            }
          >
            <ListItemText primary={`ID: ${id}`} />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
