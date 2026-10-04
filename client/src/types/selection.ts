import type {
  ReorderSelectedOperation,
  //SelectionMutationOperation,
  SetSelectionOperation,
} from "@inventory/shared";

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

export type QueuedSetSelectionOperation = SetSelectionOperation & {
  baseSelected: boolean;
};

export type QueuedReorderOperation = ReorderSelectedOperation & {
  baseServerVersion: number;
};

export type QueuedSelectionOperation =
  | QueuedSetSelectionOperation
  | QueuedReorderOperation;

export type InFlightSelectionOperation = Readonly<QueuedSelectionOperation>;

export type InFlightSelectionBatch = {
  batchId: number;
  operations: readonly InFlightSelectionOperation[];
  status: "requesting" | "transport-error";
  baseServerVersion?: number;
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

export type OptimisticReorderOperation = Readonly<{
  draggedId: number;
  targetId: number;
  placement: "before" | "after";
  search: string;
  baseServerVersion: number;
  phase: OptimisticSelectionPhase;
}>;

export type QueueReorderInput = Omit<QueuedReorderOperation, "kind">;
