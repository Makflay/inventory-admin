export type SelectionAction = "select" | "unselect";

export type OptimisticSelectionPhase =
  | "queued"
  | "in-flight"
  | "reconciling"
  | "transport-error";

export type OptimisticSelectionOperation = {
  action: SelectionAction;
  phase: OptimisticSelectionPhase;
};

export type OptimisticSelection = ReadonlyMap<
  number,
  OptimisticSelectionOperation
>;

export type QueuedSelectionOperation = {
  id: number;
  selected: boolean;
  baseSelected: boolean;
  generation: number;
  sequence: number;
};

export type InFlightSelectionOperation = Readonly<{
  id: number;
  selected: boolean;
  baseSelected: boolean;
  generation: number;
  sequence: number;
}>;

export type InFlightSelectionBatch = {
  batchId: number;
  operations: readonly InFlightSelectionOperation[];
  status: "requesting" | "transport-error";
};

export type SelectionReconciliation = {
  batchId: number;
  operations: readonly InFlightSelectionOperation[];
  availableRevision: number;
  selectedRevision: number;
  availableReconciled: boolean;
  selectedReconciled: boolean;
};

export type SelectionQueueError = {
  message: string;
  retryable: boolean;
};
