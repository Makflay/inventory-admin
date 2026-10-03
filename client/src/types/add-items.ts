export type PendingAdditionPhase =
  | "queued"
  | "in-flight"
  | "reconciling"
  | "transport-error";

export type PendingAdditions = ReadonlyMap<number, PendingAdditionPhase>;

export type AdditionInFlight = {
  batchId: number;
  ids: readonly number[];
  status: "requesting" | "transport-error";
};

export type AdditionReconciliation = {
  batchId: number;
  ids: readonly number[];
  availableRevision: number;
  availableReconciled: boolean;
};

export type AdditionQueueError = {
  message: string;
  retryable: boolean;
};
