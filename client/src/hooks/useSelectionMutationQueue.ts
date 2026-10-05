import { useCallback, useEffect, useRef, useState } from "react";

import type {
  SelectionBatchResponse,
  SelectionBatchRequest,
  SelectionMutationOperation,
} from "@inventory/shared";
import type {
  InFlightSelectionBatch,
  InFlightSelectionOperation,
  OptimisticSelection,
  OptimisticSelectionOperation,
  QueuedSelectionOperation,
  SelectionQueueError,
  SelectionReconciliation,
  OptimisticReorderOperation,
  OptimisticSelectionPhase,
  QueueReorderInput,
} from "../types/selection";

import { ApiRequestError } from "../api/api-error";
import {
  SelectionBatchRejectedError,
  updateSelectionBatch,
  StaleServerVersionError,
} from "../api/selected-items.api";
import { observeServerVersion } from "../services/server-version";

const FLUSH_INTERVAL_MS = 1000;

// function actionFromSelected(selected: boolean): "select" | "unselect" {
//   return selected ? "select" : "unselect";
// }

// function rebaseQueuedOperation(
//   queued: Map<number, QueuedSelectionOperation>,
//   id: number,
//   baseSelected: boolean,
// ): void {
//   const operation = queued.get(id);

//   if (operation === undefined) {
//     return;
//   }

//   if (operation.selected === baseSelected) {
//     queued.delete(id);
//     return;
//   }

//   queued.set(id, {
//     ...operation,
//     baseSelected,
//   });
// }

function rebaseQueuedSetSelection(
  queue: readonly QueuedSelectionOperation[],
  id: number,
  baseSelected: boolean,
): QueuedSelectionOperation[] {
  const next = [...queue];
  let lastBarrierIndex = -1;

  for (let index = 0; index < next.length; index++) {
    //const operation = next[index]!;

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
  }

  return next;
}

// function applyOptimisticSelections(
//   result: Map<number, OptimisticSelectionOperation>,
//   operations: readonly InFlightSelectionOperation[],
//   phase: OptimisticSelectionPhase,
// ): void {
//   for (const operation of operations) {
//     if (operation.kind !== "set_selection") {
//       continue;
//     }

//     result.set(operation.id, {
//       action: operation.selected ? "select" : "unselect",
//       phase,
//     });
//   }
// }

function buildOptimisticSelection(
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

function buildOptimisticReorders(
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

function failureMessage(response: SelectionBatchResponse): string | null {
  const messages = [
    ...new Set(
      response.results.flatMap((result) =>
        result.success ? [] : [result.message],
      ),
    ),
  ];

  return messages.length > 0 ? messages.join(" ") : null;
}

function reorderDependsOnId(
  operation: QueuedSelectionOperation,
  id: number,
): boolean {
  return (
    operation.kind === "reorder_selected" &&
    (operation.draggedId === id || operation.targetId === id)
  );
}

function toHttpOperation(
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

function snapshotHasSelection(
  operations: readonly InFlightSelectionOperation[],
): boolean {
  return operations.some((operation) => operation.kind === "set_selection");
}

function snapshotHasReorder(
  operations: readonly InFlightSelectionOperation[],
): boolean {
  return operations.some((operation) => operation.kind === "reorder_selected");
}

function takeSnapshotOperations(queue: readonly QueuedSelectionOperation[]): {
  operations: InFlightSelectionOperation[];
  remaining: QueuedSelectionOperation[];
  baseServerVersion?: number;
} {
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

export function useSelectionMutationQueue() {
  const queuedRef = useRef<QueuedSelectionOperation[]>([]);

  const inFlightRef = useRef<InFlightSelectionBatch | null>(null);
  const reconciliationRef = useRef<SelectionReconciliation | null>(null);

  //const generationRef = useRef(0);
  //const sequenceRef = useRef(0);
  const batchIdRef = useRef(0);
  const mountedRef = useRef(false);

  const availableRevisionRef = useRef(0);
  const selectedRevisionRef = useRef(0);

  const [optimisticSelection, setOptimisticSelection] =
    useState<OptimisticSelection>(() => new Map());

  const [availableRevision, setAvailableRevision] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState(0);

  const [optimisticReorders, setOptimisticReorders] = useState<
    readonly OptimisticReorderOperation[]
  >([]);

  const [error, setError] = useState<SelectionQueueError | null>(null);

  const publishOptimisticState = useCallback(() => {
    setOptimisticSelection(
      buildOptimisticSelection(
        queuedRef.current,
        inFlightRef.current,
        reconciliationRef.current,
      ),
    );

    setOptimisticReorders(
      buildOptimisticReorders(
        queuedRef.current,
        inFlightRef.current,
        reconciliationRef.current,
      ),
    );
  }, []);

  const startReconciliation = useCallback(
    (
      snapshot: InFlightSelectionBatch,
      operations: readonly InFlightSelectionOperation[],
      message: string | null,
    ) => {
      if (inFlightRef.current?.batchId !== snapshot.batchId) {
        return;
      }

      const requiresAvailable = snapshotHasSelection(operations);
      const requiresSelected =
        requiresAvailable || snapshotHasReorder(operations);

      if (!requiresAvailable && !requiresSelected) {
        inFlightRef.current = null;

        setError(
          message === null
            ? null
            : {
                message,
                retryable: false,
              },
        );

        publishOptimisticState();
        return;
      }

      const nextAvailableRevision = requiresAvailable
        ? availableRevisionRef.current + 1
        : availableRevisionRef.current;

      const nextSelectedRevision = requiresSelected
        ? selectedRevisionRef.current + 1
        : selectedRevisionRef.current;

      if (requiresAvailable) {
        availableRevisionRef.current = nextAvailableRevision;
      }

      if (requiresSelected) {
        selectedRevisionRef.current = nextSelectedRevision;
      }

      reconciliationRef.current = {
        batchId: snapshot.batchId,
        operations,
        availableRevision: nextAvailableRevision,
        selectedRevision: nextSelectedRevision,
        availableReconciled: !requiresAvailable,
        selectedReconciled: !requiresSelected,
      };

      inFlightRef.current = null;

      setError(
        message === null
          ? null
          : {
              message,
              retryable: false,
            },
      );

      publishOptimisticState();

      if (requiresAvailable) {
        setAvailableRevision(nextAvailableRevision);
      }

      if (requiresSelected) {
        setSelectedRevision(nextSelectedRevision);
      }
    },
    [publishOptimisticState],
  );

  const resolveRejectedSnapshot = useCallback(
    (snapshot: InFlightSelectionBatch, message: string) => {
      if (inFlightRef.current?.batchId !== snapshot.batchId) {
        return;
      }

      for (const operation of snapshot.operations) {
        if (operation.kind !== "set_selection") {
          continue;
        }

        queuedRef.current = rebaseQueuedSetSelection(
          queuedRef.current,
          operation.id,
          operation.baseSelected,
        );
      }

      inFlightRef.current = null;

      setError({
        message,
        retryable: false,
      });

      publishOptimisticState();
    },
    [publishOptimisticState],
  );

  const resolveResponse = useCallback(
    (snapshot: InFlightSelectionBatch, response: SelectionBatchResponse) => {
      if (inFlightRef.current?.batchId !== snapshot.batchId) {
        return;
      }

      const successfulOperations: InFlightSelectionOperation[] = [];

      response.results.forEach((result, index) => {
        const operation = snapshot.operations[index];

        if (operation === undefined) {
          return;
        }

        if (result.success) {
          successfulOperations.push(operation);

          if (operation.kind === "set_selection") {
            queuedRef.current = rebaseQueuedSetSelection(
              queuedRef.current,
              operation.id,
              operation.selected,
            );
          }

          return;
        }

        if (operation.kind === "set_selection") {
          queuedRef.current = rebaseQueuedSetSelection(
            queuedRef.current,
            operation.id,
            operation.baseSelected,
          );
        }
      });

      const domainFailureMessage = failureMessage(response);

      if (successfulOperations.length === 0) {
        inFlightRef.current = null;

        setError(
          domainFailureMessage === null
            ? null
            : {
                message: domainFailureMessage,
                retryable: false,
              },
        );

        publishOptimisticState();
        return;
      }

      startReconciliation(snapshot, successfulOperations, domainFailureMessage);

      // const nextAvailableRevision = availableRevisionRef.current + 1;

      // const nextSelectedRevision = selectedRevisionRef.current + 1;

      // availableRevisionRef.current = nextAvailableRevision;
      // selectedRevisionRef.current = nextSelectedRevision;
      // reconciliationRef.current = {
      //   batchId: snapshot.batchId,
      //   operations: successfulOperations,
      //   availableRevision: nextAvailableRevision,
      //   selectedRevision: nextSelectedRevision,
      //   availableReconciled: false,
      //   selectedReconciled: false,
      // };

      // inFlightRef.current = null;

      // setError(
      //   domainFailureMessage === null
      //     ? null
      //     : {
      //         message: domainFailureMessage,
      //         retryable: false,
      //       },
      // );

      // publishOptimisticState();

      // setAvailableRevision(nextAvailableRevision);
      // setSelectedRevision(nextSelectedRevision);
    },
    [publishOptimisticState, startReconciliation],
  );

  const sendSnapshot = useCallback(
    async (snapshot: InFlightSelectionBatch) => {
      try {
        const request: SelectionBatchRequest = {
          operations: snapshot.operations.map(toHttpOperation),
          ...(snapshot.baseServerVersion === undefined
            ? {}
            : { baseServerVersion: snapshot.baseServerVersion }),
        };

        const response = await updateSelectionBatch(request);

        if (!mountedRef.current) {
          return;
        }

        observeServerVersion(response.serverVersion);
        resolveResponse(snapshot, response);
      } catch (requestError) {
        if (
          !mountedRef.current ||
          inFlightRef.current?.batchId !== snapshot.batchId
        ) {
          return;
        }

        if (requestError instanceof StaleServerVersionError) {
          observeServerVersion(requestError.serverVersion);

          startReconciliation(
            snapshot,
            snapshot.operations,
            requestError.message,
          );

          return;
        }

        if (requestError instanceof SelectionBatchRejectedError) {
          resolveRejectedSnapshot(snapshot, requestError.message);

          return;
        }

        inFlightRef.current = {
          ...snapshot,
          status: "transport-error",
        };

        setError({
          message:
            requestError instanceof ApiRequestError
              ? requestError.message
              : "Не удалось сохранить изменения выбора. Попробуйте снова.",
          retryable: true,
        });

        publishOptimisticState();
      }
    },
    [
      publishOptimisticState,
      resolveRejectedSnapshot,
      resolveResponse,
      startReconciliation,
    ],
  );

  const flush = useCallback(() => {
    if (
      queuedRef.current.length === 0 ||
      inFlightRef.current !== null ||
      reconciliationRef.current !== null
    ) {
      return;
    }

    // const operations = [...queuedRef.current.values()]
    //   .sort((left, right) => left.sequence - right.sequence)
    //   .map<InFlightSelectionOperation>((operation) => ({
    //     ...operation,
    //   }));

    // for (const operation of operations) {
    //   const queued = queuedRef.current.get(operation.id);

    //   if (queued?.generation === operation.generation) {
    //     queuedRef.current.delete(operation.id);
    //   }
    // }

    const snapshotData = takeSnapshotOperations(queuedRef.current);

    if (snapshotData.operations.length === 0) {
      return;
    }

    queuedRef.current = snapshotData.remaining;

    const snapshot: InFlightSelectionBatch = {
      batchId: ++batchIdRef.current,
      operations: snapshotData.operations,
      baseServerVersion: snapshotData.baseServerVersion,
      status: "requesting",
    };

    inFlightRef.current = snapshot;

    setError(null);
    publishOptimisticState();

    void sendSnapshot(snapshot);
  }, [publishOptimisticState, sendSnapshot]);

  const flushRef = useRef(flush);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    mountedRef.current = true;

    const intervalId = window.setInterval(() => {
      flushRef.current();
    }, FLUSH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const queueSelection = useCallback(
    (id: number, selected: boolean) => {
      const queue = queuedRef.current;
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
          return;
        }

        if (existing.selected === selected) {
          return;
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

        queuedRef.current = next;

        setError((previous) =>
          previous?.retryable === true ? previous : null,
        );

        publishOptimisticState();
        return;
      }

      let currentSelected = !selected;

      const priorOperations: readonly InFlightSelectionOperation[] = [
        ...(reconciliationRef.current?.operations ?? []),
        ...(inFlightRef.current?.operations ?? []),
        ...queue,
      ];

      for (const operation of priorOperations) {
        if (operation.kind === "set_selection" && operation.id === id) {
          currentSelected = operation.selected;
        }
      }

      if (currentSelected === selected) {
        return;
      }

      queuedRef.current = [
        ...queue,
        {
          kind: "set_selection",
          id,
          selected,
          baseSelected: currentSelected,
        },
      ];

      setError((previous) => (previous?.retryable === true ? previous : null));

      publishOptimisticState();
    },
    [publishOptimisticState],
  );

  const queueReorder = useCallback(
    (input: QueueReorderInput): boolean => {
      if (input.draggedId === input.targetId || input.baseServerVersion < 0) {
        return false;
      }

      const pendingVersions = [
        ...queuedRef.current,
        ...(inFlightRef.current?.operations ?? []),
        ...(reconciliationRef.current?.operations ?? []),
      ].flatMap((operation) =>
        operation.kind === "reorder_selected"
          ? [operation.baseServerVersion]
          : [],
      );

      if (
        pendingVersions.some((version) => version !== input.baseServerVersion)
      ) {
        return false;
      }

      queuedRef.current = [
        ...queuedRef.current,
        {
          kind: "reorder_selected",
          ...input,
        },
      ];

      setError((previous) => (previous?.retryable === true ? previous : null));
      publishOptimisticState();

      return true;
    },
    [publishOptimisticState],
  );

  const retry = useCallback(() => {
    const snapshot = inFlightRef.current;

    if (snapshot === null || snapshot.status !== "transport-error") {
      return;
    }

    const retrySnapshot: InFlightSelectionBatch = {
      ...snapshot,
      status: "requesting",
    };

    inFlightRef.current = retrySnapshot;

    setError(null);
    publishOptimisticState();

    void sendSnapshot(retrySnapshot);
  }, [publishOptimisticState, sendSnapshot]);

  const confirmAvailableRevision = useCallback(
    (revision: number) => {
      const reconciliation = reconciliationRef.current;

      if (
        reconciliation === null ||
        reconciliation.availableRevision !== revision ||
        reconciliation.availableReconciled
      ) {
        return;
      }

      const updated: SelectionReconciliation = {
        ...reconciliation,
        availableReconciled: true,
      };

      if (updated.selectedReconciled) {
        reconciliationRef.current = null;
      } else {
        reconciliationRef.current = updated;
      }

      publishOptimisticState();
    },
    [publishOptimisticState],
  );

  const confirmSelectedRevision = useCallback(
    (revision: number) => {
      const reconciliation = reconciliationRef.current;

      if (
        reconciliation === null ||
        reconciliation.selectedRevision !== revision ||
        reconciliation.selectedReconciled
      ) {
        return;
      }

      const updated: SelectionReconciliation = {
        ...reconciliation,
        selectedReconciled: true,
      };

      if (updated.availableReconciled) {
        reconciliationRef.current = null;
      } else {
        reconciliationRef.current = updated;
      }

      publishOptimisticState();
    },
    [publishOptimisticState],
  );

  return {
    optimisticSelection,
    availableRevision,
    selectedRevision,
    error,
    optimisticReorders,
    queueSelection,
    retry,
    confirmAvailableRevision,
    confirmSelectedRevision,
    queueReorder,
  };
}
