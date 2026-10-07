export type ReorderSelectedResult =
  | "updated"
  | "unchanged"
  | "dragged_not_selected"
  | "target_not_selected"
  | "dragged_not_matching_search"
  | "target_not_matching_search"
  | "same_item";

type SelectedOrderReplacement = {
  index: number;
  id: number;
};

export type SelectedReorderCalculation =
  | {
      status: "updated";
      replacements: readonly SelectedOrderReplacement[];
    }
  | {
      status: Exclude<ReorderSelectedResult, "updated">;
    };

type CalculateSelectedReorderInput = {
  selectedOrder: readonly number[];
  selectedIds: ReadonlySet<number>;
  draggedId: number;
  targetId: number;
  placement: "before" | "after";
  search: string;
};

function matchesSearch(id: number, search: string): boolean {
  return search === "" || String(id).includes(search);
}

export function calculateSelectedReorder({
  selectedOrder,
  selectedIds,
  draggedId,
  targetId,
  placement,
  search,
}: CalculateSelectedReorderInput): SelectedReorderCalculation {
  if (draggedId === targetId) {
    return {
      status: "same_item",
    };
  }

  if (!selectedIds.has(draggedId)) {
    return {
      status: "dragged_not_selected",
    };
  }

  if (!selectedIds.has(targetId)) {
    return {
      status: "target_not_selected",
    };
  }

  if (!matchesSearch(draggedId, search)) {
    return {
      status: "dragged_not_matching_search",
    };
  }

  if (!matchesSearch(targetId, search)) {
    return {
      status: "target_not_matching_search",
    };
  }

  const matchingSlots: number[] = [];
  const matchingIds: number[] = [];

  for (const [index, id] of selectedOrder.entries()) {
    if (matchesSearch(id, search)) {
      matchingSlots.push(index);
      matchingIds.push(id);
    }
  }

  const draggedIndex = matchingIds.indexOf(draggedId);

  if (draggedIndex < 0) {
    return {
      status: "dragged_not_matching_search",
    };
  }

  matchingIds.splice(draggedIndex, 1);

  const targetIndex = matchingIds.indexOf(targetId);

  if (targetIndex < 0) {
    return {
      status: "target_not_matching_search",
    };
  }

  const insertionIndex = placement === "before" ? targetIndex : targetIndex + 1;

  matchingIds.splice(insertionIndex, 0, draggedId);

  const unchanged = matchingSlots.every(
    (slot, index) => selectedOrder[slot] === matchingIds[index],
  );

  if (unchanged) {
    return {
      status: "unchanged",
    };
  }

  return {
    status: "updated",
    replacements: matchingSlots.map((slot, index) => ({
      index: slot,
      id: matchingIds[index]!,
    })),
  };
}
