import type {
  SelectionBatchResponse,
  SelectionMutationOperation,
} from "@inventory/shared";
import type {
  InFlightSelectionBatch,
  InFlightSelectionOperation,
  OptimisticReorderOperation,
  OptimisticSelection,
  OptimisticSelectionOperation,
  OptimisticSelectionPhase,
  QueuedSelectionOperation,
  QueueReorderInput,
  SelectionReconciliation,
} from "../types/selection";

export type SelectionSnapshot = {
  operations: InFlightSelectionOperation[];
  remaining: QueuedSelectionOperation[];
  baseServerVersion?: number;
};

export type EnqueueSetSelectionResult = {
  queue: QueuedSelectionOperation[];
  changed: boolean;
};

export function reorderDependsOnId(
  operation: QueuedSelectionOperation,
  id: number,
): boolean {
  return (
    operation.kind === "reorder_selected" &&
    (operation.draggedId === id || operation.targetId === id)
  );
}

export function rebaseQueuedSetSelection(
  queue: readonly QueuedSelectionOperation[],
  id: number,
  baseSelected: boolean,
): QueuedSelectionOperation[] {
  const next = [...queue];
  let lastBarrierIndex = -1;

  for (let index = next.length - 1; index >= 0; index--) {
    if (reorderDependsOnId(next[index]!, id)) {
      lastBarrierIndex = index;
      break;
    }
  }

  for (let index = lastBarrierIndex + 1; index < next.length; index++) {
    const operation = next[index];

    if (operation.kind !== "set_selection" || operation.id !== id) {
      continue;
    }

    if (operation.selected === baseSelected) {
      next.splice(index, 1);
    } else {
      next[index] = {
        ...operation,
        baseSelected,
      };
    }

    break;
  }

  return next;
}

export function buildOptimisticSelection(
  queued: readonly QueuedSelectionOperation[],
  inFlight: InFlightSelectionBatch | null,
  reconciliation: SelectionReconciliation | null,
): OptimisticSelection {
  const result = new Map<number, OptimisticSelectionOperation>();

  const apply = (
    operations: readonly InFlightSelectionOperation[],
    phase: OptimisticSelectionPhase,
  ) => {
    for (const operation of operations) {
      if (operation.kind !== "set_selection") {
        continue;
      }

      result.set(operation.id, {
        action: operation.selected ? "select" : "unselect",
        phase,
      });
    }
  };

  if (reconciliation !== null) {
    apply(reconciliation.operations, "reconciling");
  }

  if (inFlight !== null) {
    apply(
      inFlight.operations,
      inFlight.status === "transport-error" ? "transport-error" : "in-flight",
    );
  }

  apply(queued, "queued");

  return result;
}

export function buildOptimisticReorders(
  queued: readonly QueuedSelectionOperation[],
  inFlight: InFlightSelectionBatch | null,
  reconciliation: SelectionReconciliation | null,
): OptimisticReorderOperation[] {
  const result: OptimisticReorderOperation[] = [];

  const append = (
    operations: readonly InFlightSelectionOperation[],
    phase: OptimisticSelectionPhase,
  ) => {
    for (const operation of operations) {
      if (operation.kind !== "reorder_selected") {
        continue;
      }

      result.push({
        draggedId: operation.draggedId,
        targetId: operation.targetId,
        placement: operation.placement,
        search: operation.search,
        baseServerVersion: operation.baseServerVersion,
        phase,
      });
    }
  };

  if (reconciliation !== null) {
    append(reconciliation.operations, "reconciling");
  }

  if (inFlight !== null) {
    append(
      inFlight.operations,
      inFlight.status === "transport-error" ? "transport-error" : "in-flight",
    );
  }

  append(queued, "queued");

  return result;
}

export function selectionFailureMessage(
  response: SelectionBatchResponse,
): string | null {
  const messages = [
    ...new Set(
      response.results.flatMap((result) =>
        result.success ? [] : [result.message],
      ),
    ),
  ];

  return messages.length > 0 ? messages.join(" ") : null;
}

export function toHttpSelectionOperation(
  operation: InFlightSelectionOperation,
): SelectionMutationOperation {
  if (operation.kind === "set_selection") {
    return {
      kind: "set_selection",
      id: operation.id,
      selected: operation.selected,
    };
  }

  return {
    kind: "reorder_selected",
    draggedId: operation.draggedId,
    targetId: operation.targetId,
    placement: operation.placement,
    search: operation.search,
  };
}

export function snapshotHasSelection(
  operations: readonly InFlightSelectionOperation[],
): boolean {
  return operations.some((operation) => operation.kind === "set_selection");
}

export function snapshotHasReorder(
  operations: readonly InFlightSelectionOperation[],
): boolean {
  return operations.some((operation) => operation.kind === "reorder_selected");
}

export function takeSnapshotOperations(
  queue: readonly QueuedSelectionOperation[],
): SelectionSnapshot {
  let batchBaseVersion: number | undefined;
  let endIndex = queue.length;

  for (const [index, operation] of queue.entries()) {
    if (operation.kind !== "reorder_selected") {
      continue;
    }

    if (batchBaseVersion === undefined) {
      batchBaseVersion = operation.baseServerVersion;
      continue;
    }

    if (operation.baseServerVersion !== batchBaseVersion) {
      endIndex = index;
      break;
    }
  }

  return {
    operations: queue.slice(0, endIndex),
    remaining: queue.slice(endIndex),
    baseServerVersion: batchBaseVersion,
  };
}

export function enqueueSetSelection(
  queue: readonly QueuedSelectionOperation[],
  earlierPendingOperations: readonly InFlightSelectionOperation[],
  id: number,
  selected: boolean,
): EnqueueSetSelectionResult {
  let barrierIndex = -1;

  for (let index = queue.length - 1; index >= 0; index--) {
    if (reorderDependsOnId(queue[index]!, id)) {
      barrierIndex = index;
      break;
    }
  }

  let existingIndex = -1;

  for (let index = queue.length - 1; index > barrierIndex; index--) {
    const operation = queue[index];

    if (operation?.kind === "set_selection" && operation.id === id) {
      existingIndex = index;
      break;
    }
  }

  if (existingIndex >= 0) {
    const existing = queue[existingIndex];

    if (existing?.kind !== "set_selection") {
      return {
        queue: [...queue],
        changed: false,
      };
    }

    if (existing.selected === selected) {
      return {
        queue: [...queue],
        changed: false,
      };
    }

    const next = [...queue];

    if (selected === existing.baseSelected) {
      next.splice(existingIndex, 1);
    } else {
      next[existingIndex] = {
        ...existing,
        selected,
      };
    }

    return {
      queue: next,
      changed: true,
    };
  }

  let currentSelected = !selected;

  const priorOperations: readonly InFlightSelectionOperation[] = [
    ...earlierPendingOperations,
    ...queue,
  ];

  for (const operation of priorOperations) {
    if (operation.kind === "set_selection" && operation.id === id) {
      currentSelected = operation.selected;
    }
  }

  if (currentSelected === selected) {
    return {
      queue: [...queue],
      changed: false,
    };
  }

  return {
    queue: [
      ...queue,
      {
        kind: "set_selection",
        id,
        selected,
        baseSelected: currentSelected,
      },
    ],
    changed: true,
  };
}

export function canQueueReorder(
  input: QueueReorderInput,
  pendingOperations: readonly InFlightSelectionOperation[],
): boolean {
  if (input.draggedId === input.targetId || input.baseServerVersion < 0) {
    return false;
  }

  return pendingOperations.every(
    (operation) =>
      operation.kind !== "reorder_selected" ||
      operation.baseServerVersion === input.baseServerVersion,
  );
}
