import { useCallback, useEffect, useRef, useState } from "react";

import type {
  SelectionBatchResponse,
  SelectionBatchRequest,
} from "@inventory/shared";
import type {
  InFlightSelectionBatch,
  InFlightSelectionOperation,
  OptimisticSelection,
  QueuedSelectionOperation,
  SelectionQueueError,
  SelectionReconciliation,
  OptimisticReorderOperation,
  QueueReorderInput,
} from "../types/selection";

import { ApiRequestError } from "../api/api-error";
import {
  SelectionBatchRejectedError,
  updateSelectionBatch,
  StaleServerVersionError,
} from "../api/selected-items.api";
import { observeServerVersion } from "../services/server-version";
import {
  buildOptimisticSelection,
  snapshotHasSelection,
  rebaseQueuedSetSelection,
  snapshotHasReorder,
  selectionFailureMessage,
  enqueueSetSelection,
  canQueueReorder,
  takeSnapshotOperations,
  toHttpSelectionOperation,
  buildOptimisticReorders,
} from "../services/selection-queue-logic";

const FLUSH_INTERVAL_MS = 1000;

export function useSelectionMutationQueue() {
  const queuedRef = useRef<QueuedSelectionOperation[]>([]);
  const inFlightRef = useRef<InFlightSelectionBatch | null>(null);
  const reconciliationRef = useRef<SelectionReconciliation | null>(null);
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

      const domainFailureMessage = selectionFailureMessage(response);

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
    },
    [publishOptimisticState, startReconciliation],
  );

  const sendSnapshot = useCallback(
    async (snapshot: InFlightSelectionBatch) => {
      try {
        const request: SelectionBatchRequest = {
          operations: snapshot.operations.map(toHttpSelectionOperation),
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
      const result = enqueueSetSelection(
        queuedRef.current,
        [
          ...(reconciliationRef.current?.operations ?? []),
          ...(inFlightRef.current?.operations ?? []),
        ],
        id,
        selected,
      );

      if (!result.changed) {
        return;
      }

      queuedRef.current = result.queue;

      setError((previous) => (previous?.retryable === true ? previous : null));

      publishOptimisticState();
    },
    [publishOptimisticState],
  );

  const queueReorder = useCallback(
    (input: QueueReorderInput): boolean => {
      const pendingOperations: readonly InFlightSelectionOperation[] = [
        ...queuedRef.current,
        ...(inFlightRef.current?.operations ?? []),
        ...(reconciliationRef.current?.operations ?? []),
      ];

      if (!canQueueReorder(input, pendingOperations)) {
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
