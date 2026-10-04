import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Button, ListItem, ListItemText } from "@mui/material";

type SelectedItemRowProps = {
  id: number;
  regionKey: string | null;
  optimistic: boolean;
  dndDisabled: boolean;
  selectionActionsDisabled: boolean;
  onUnselect: (id: number) => void;
};

export function SelectedItemRow({
  id,
  regionKey,
  optimistic,
  dndDisabled,
  selectionActionsDisabled,
  onUnselect,
}: SelectedItemRowProps) {
  const draggable = useDraggable({
    id: `selected:${id}`,
    disabled: dndDisabled,
    data: {
      id,
      regionKey,
    },
  });

  const droppable = useDroppable({
    id: `selected:${id}`,
    disabled: dndDisabled,
    data: {
      id,
      regionKey,
    },
  });

  const setNodeRef = (node: HTMLDivElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };

  return (
    <ListItem
      ref={setNodeRef}
      component="div"
      data-selected-item-id={id}
      data-selected-region-key={regionKey ?? undefined}
      divider
      secondaryAction={
        <Button
          size="small"
          disabled={selectionActionsDisabled}
          onClick={() => {
            onUnselect(id);
          }}
        >
          Убрать
        </Button>
      }
      sx={{
        height: 48,
        boxSizing: "border-box",
        opacity: draggable.isDragging ? 0.45 : 1,
        cursor: dndDisabled ? "default" : "grab",
        touchAction: "none",
        outline: droppable.isOver ? "2px solid" : undefined,
        outlineColor: "primary.main",
      }}
      {...draggable.attributes}
      {...draggable.listeners}
    >
      <ListItemText
        primary={`ID: ${id}`}
        secondary={optimistic ? "Сохранение…" : undefined}
      />
    </ListItem>
  );
}
