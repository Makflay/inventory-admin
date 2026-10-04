import { useCallback, useEffect, useRef, useState } from "react";

import type { SelectionBatchResponse } from "@inventory/shared";
import type {
  InFlightSelectionBatch,
  InFlightSelectionOperation,
  OptimisticSelection,
  OptimisticSelectionOperation,
  QueuedSelectionOperation,
  SelectionQueueError,
  SelectionReconciliation,
} from "../types/selection";

import { ApiRequestError } from "../api/api-error";
import {
  SelectionBatchRejectedError,
  updateSelectionBatch,
} from "../api/selected-items.api";
import { observeServerVersion } from "../services/server-version";

const FLUSH_INTERVAL_MS = 1000;

function actionFromSelected(selected: boolean): "select" | "unselect" {
  return selected ? "select" : "unselect";
}

function rebaseQueuedOperation(
  queued: Map<number, QueuedSelectionOperation>,
  id: number,
  baseSelected: boolean,
): void {
  const operation = queued.get(id);

  if (operation === undefined) {
    return;
  }

  if (operation.selected === baseSelected) {
    queued.delete(id);
    return;
  }

  queued.set(id, {
    ...operation,
    baseSelected,
  });
}

function buildOptimisticSelection(
  queued: ReadonlyMap<number, QueuedSelectionOperation>,
  inFlight: InFlightSelectionBatch | null,
  reconciliation: SelectionReconciliation | null,
): OptimisticSelection {
  const result = new Map<number, OptimisticSelectionOperation>();

  if (reconciliation !== null) {
    for (const operation of reconciliation.operations) {
      result.set(operation.id, {
        action: actionFromSelected(operation.selected),
        phase: "reconciling",
      });
    }
  }

  if (inFlight !== null) {
    for (const operation of inFlight.operations) {
      result.set(operation.id, {
        action: actionFromSelected(operation.selected),
        phase:
          inFlight.status === "transport-error"
            ? "transport-error"
            : "in-flight",
      });
    }
  }

  const queuedOperations = [...queued.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );

  for (const operation of queuedOperations) {
    result.delete(operation.id);

    result.set(operation.id, {
      action: actionFromSelected(operation.selected),
      phase: "queued",
    });
  }

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

export function useSelectionMutationQueue() {
  const queuedRef = useRef(new Map<number, QueuedSelectionOperation>());

  const inFlightRef = useRef<InFlightSelectionBatch | null>(null);
  const reconciliationRef = useRef<SelectionReconciliation | null>(null);

  const generationRef = useRef(0);
  const sequenceRef = useRef(0);
  const batchIdRef = useRef(0);
  const mountedRef = useRef(false);

  const availableRevisionRef = useRef(0);
  const selectedRevisionRef = useRef(0);

  const [optimisticSelection, setOptimisticSelection] =
    useState<OptimisticSelection>(() => new Map());

  const [availableRevision, setAvailableRevision] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState(0);

  const [error, setError] = useState<SelectionQueueError | null>(null);

  const publishOptimisticSelection = useCallback(() => {
    setOptimisticSelection(
      buildOptimisticSelection(
        queuedRef.current,
        inFlightRef.current,
        reconciliationRef.current,
      ),
    );
  }, []);

  const resolveRejectedSnapshot = useCallback(
    (snapshot: InFlightSelectionBatch, message: string) => {
      if (inFlightRef.current?.batchId !== snapshot.batchId) {
        return;
      }

      for (const operation of snapshot.operations) {
        rebaseQueuedOperation(
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

      publishOptimisticSelection();
    },
    [publishOptimisticSelection],
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

          rebaseQueuedOperation(
            queuedRef.current,
            operation.id,
            operation.selected,
          );

          return;
        }

        rebaseQueuedOperation(
          queuedRef.current,
          operation.id,
          operation.baseSelected,
        );
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

        publishOptimisticSelection();
        return;
      }

      const nextAvailableRevision = availableRevisionRef.current + 1;

      const nextSelectedRevision = selectedRevisionRef.current + 1;

      availableRevisionRef.current = nextAvailableRevision;
      selectedRevisionRef.current = nextSelectedRevision;
      reconciliationRef.current = {
        batchId: snapshot.batchId,
        operations: successfulOperations,
        availableRevision: nextAvailableRevision,
        selectedRevision: nextSelectedRevision,
        availableReconciled: false,
        selectedReconciled: false,
      };

      inFlightRef.current = null;

      setError(
        domainFailureMessage === null
          ? null
          : {
              message: domainFailureMessage,
              retryable: false,
            },
      );

      publishOptimisticSelection();

      setAvailableRevision(nextAvailableRevision);
      setSelectedRevision(nextSelectedRevision);
    },
    [publishOptimisticSelection],
  );

  const sendSnapshot = useCallback(
    async (snapshot: InFlightSelectionBatch) => {
      try {
        const response = await updateSelectionBatch({
          operations: snapshot.operations.map(({ id, selected }) => ({
            id,
            selected,
          })),
        });

        if (!mountedRef.current) {
          return;
        }

        observeServerVersion(response.serverVersion);
        resolveResponse(snapshot, response);

        resolveResponse(snapshot, response);
      } catch (requestError) {
        if (
          !mountedRef.current ||
          inFlightRef.current?.batchId !== snapshot.batchId
        ) {
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

        publishOptimisticSelection();
      }
    },
    [publishOptimisticSelection, resolveRejectedSnapshot, resolveResponse],
  );

  const flush = useCallback(() => {
    if (
      queuedRef.current.size === 0 ||
      inFlightRef.current !== null ||
      reconciliationRef.current !== null
    ) {
      return;
    }

    const operations = [...queuedRef.current.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map<InFlightSelectionOperation>((operation) => ({
        ...operation,
      }));

    for (const operation of operations) {
      const queued = queuedRef.current.get(operation.id);

      if (queued?.generation === operation.generation) {
        queuedRef.current.delete(operation.id);
      }
    }

    const snapshot: InFlightSelectionBatch = {
      batchId: ++batchIdRef.current,
      operations,
      status: "requesting",
    };

    inFlightRef.current = snapshot;

    setError(null);
    publishOptimisticSelection();

    void sendSnapshot(snapshot);
  }, [publishOptimisticSelection, sendSnapshot]);

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
      const queued = queuedRef.current.get(id);

      const inFlightOperation = inFlightRef.current?.operations.find(
        (operation) => operation.id === id,
      );

      const reconciliationOperation =
        reconciliationRef.current?.operations.find(
          (operation) => operation.id === id,
        );

      const currentDesired =
        queued?.selected ??
        inFlightOperation?.selected ??
        reconciliationOperation?.selected ??
        !selected;

      if (currentDesired === selected) {
        return;
      }

      const baseSelected =
        queued?.baseSelected ??
        inFlightOperation?.selected ??
        reconciliationOperation?.selected ??
        !selected;

      if (selected === baseSelected) {
        queuedRef.current.delete(id);
      } else {
        const operation: QueuedSelectionOperation = {
          id,
          selected,
          baseSelected,
          generation: ++generationRef.current,
          sequence: ++sequenceRef.current,
        };

        queuedRef.current.delete(id);
        queuedRef.current.set(id, operation);
      }

      if (error?.retryable !== true) {
        setError(null);
      }

      publishOptimisticSelection();
    },
    [error, publishOptimisticSelection],
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
    publishOptimisticSelection();

    void sendSnapshot(retrySnapshot);
  }, [publishOptimisticSelection, sendSnapshot]);

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

      publishOptimisticSelection();
    },
    [publishOptimisticSelection],
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

      publishOptimisticSelection();
    },
    [publishOptimisticSelection],
  );

  return {
    optimisticSelection,
    availableRevision,
    selectedRevision,
    error,
    queueSelection,
    retry,
    confirmAvailableRevision,
    confirmSelectedRevision,
  };
}
