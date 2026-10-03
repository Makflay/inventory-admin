export type SelectionAction = "select" | "unselect";

export type OptimisticSelectionOperation = {
  action: SelectionAction;
  phase: "pending" | "reconciling";
  availableRevision: number | null;
  selectedRevision: number | null;
  availableReconciled: boolean;
  selectedReconciled: boolean;
};

export type OptimisticSelection = ReadonlyMap<
  number,
  OptimisticSelectionOperation
>;
