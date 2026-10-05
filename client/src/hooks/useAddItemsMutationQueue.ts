import { useCallback, useEffect, useRef, useState } from "react";

import type { AddItemsBatchResponse } from "@inventory/shared";
import type {
  AdditionInFlight,
  AdditionQueueError,
  AdditionReconciliation,
  PendingAdditions,
} from "../types/add-items";

import { AdditionBatchRejectedError, addItemsBatch } from "../api/items.api";
import { ApiRequestError } from "../api/api-error";
import { observeServerVersion } from "../services/server-version";

const FLUSH_INTERVAL_MS = 10_000;

function buildPendingAdditions(
  queued: ReadonlySet<number>,
  inFlight: AdditionInFlight | null,
  reconciliation: AdditionReconciliation | null,
): PendingAdditions {
  const result = new Map<
    number,
    "queued" | "in-flight" | "reconciling" | "transport-error"
  >();

  if (reconciliation !== null) {
    for (const id of reconciliation.ids) {
      result.set(id, "reconciling");
    }
  }

  if (inFlight !== null) {
    const phase =
      inFlight.status === "transport-error" ? "transport-error" : "in-flight";

    for (const id of inFlight.ids) {
      result.set(id, phase);
    }
  }

  for (const id of queued) {
    result.set(id, "queued");
  }

  return result;
}

function rejectedMessage(response: AddItemsBatchResponse): string | null {
  const messages = [
    ...new Set(
      response.results.flatMap((result) =>
        result.status === "rejected" ? [result.message] : [],
      ),
    ),
  ];

  return messages.length > 0 ? messages.join(" ") : null;
}

export function useAddItemsMutationQueue() {
  const queuedRef = useRef<Set<number>>(new Set());
  const inFlightRef = useRef<AdditionInFlight | null>(null);
  const reconciliationRef = useRef<AdditionReconciliation | null>(null);

  const batchIdRef = useRef(0);
  const availableRevisionRef = useRef(0);
  const mountedRef = useRef(false);

  const [pendingAdditions, setPendingAdditions] = useState<PendingAdditions>(
    () => new Map(),
  );

  const [availableRevision, setAvailableRevision] = useState(0);
  const [error, setError] = useState<AdditionQueueError | null>(null);

  const publishPendingAdditions = useCallback(() => {
    setPendingAdditions(
      buildPendingAdditions(
        queuedRef.current,
        inFlightRef.current,
        reconciliationRef.current,
      ),
    );
  }, []);

  const resolveRejectedSnapshot = useCallback(
    (snapshot: AdditionInFlight, message: string) => {
      if (inFlightRef.current?.batchId !== snapshot.batchId) {
        return;
      }

      inFlightRef.current = null;

      setError({
        message,
        retryable: false,
      });

      publishPendingAdditions();
    },
    [publishPendingAdditions],
  );

  const resolveResponse = useCallback(
    (snapshot: AdditionInFlight, response: AddItemsBatchResponse) => {
      if (inFlightRef.current?.batchId !== snapshot.batchId) {
        return;
      }

      const successfulIds = response.results.flatMap((result) =>
        result.status === "added" || result.status === "already_exists"
          ? [result.id]
          : [],
      );

      const domainError = rejectedMessage(response);

      if (successfulIds.length === 0) {
        inFlightRef.current = null;

        setError(
          domainError === null
            ? null
            : {
                message: domainError,
                retryable: false,
              },
        );

        publishPendingAdditions();
        return;
      }

      const nextAvailableRevision = availableRevisionRef.current + 1;

      availableRevisionRef.current = nextAvailableRevision;
      reconciliationRef.current = {
        batchId: snapshot.batchId,
        ids: successfulIds,
        availableRevision: nextAvailableRevision,
        availableReconciled: false,
      };

      inFlightRef.current = null;

      setError(
        domainError === null
          ? null
          : {
              message: domainError,
              retryable: false,
            },
      );

      publishPendingAdditions();
      setAvailableRevision(nextAvailableRevision);
    },
    [publishPendingAdditions],
  );

  const sendSnapshot = useCallback(
    async (snapshot: AdditionInFlight) => {
      try {
        const response = await addItemsBatch({
          ids: [...snapshot.ids],
        });

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

        if (requestError instanceof AdditionBatchRejectedError) {
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
              : "Не удалось добавить элементы. Попробуйте снова.",
          retryable: true,
        });

        publishPendingAdditions();
      }
    },
    [publishPendingAdditions, resolveRejectedSnapshot, resolveResponse],
  );

  const flush = useCallback(() => {
    if (
      queuedRef.current.size === 0 ||
      inFlightRef.current !== null ||
      reconciliationRef.current !== null
    ) {
      return;
    }

    const ids = [...queuedRef.current];
    queuedRef.current.clear();

    const snapshot: AdditionInFlight = {
      batchId: ++batchIdRef.current,
      ids,
      status: "requesting",
    };

    inFlightRef.current = snapshot;

    setError(null);
    publishPendingAdditions();

    void sendSnapshot(snapshot);
  }, [publishPendingAdditions, sendSnapshot]);

  const flushRef = useRef<() => void>(() => undefined);

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

  const queueAddition = useCallback(
    (id: number): "queued" | "already-pending" => {
      const alreadyQueued = queuedRef.current.has(id);
      const alreadyInFlight = inFlightRef.current?.ids.includes(id) === true;
      const alreadyReconciling =
        reconciliationRef.current?.ids.includes(id) === true;

      if (alreadyQueued || alreadyInFlight || alreadyReconciling) {
        return "already-pending";
      }

      queuedRef.current.add(id);

      if (error?.retryable !== true) {
        setError(null);
      }

      publishPendingAdditions();

      return "queued";
    },
    [error, publishPendingAdditions],
  );

  const retry = useCallback(() => {
    const snapshot = inFlightRef.current;

    if (snapshot === null || snapshot.status !== "transport-error") {
      return;
    }

    const retrySnapshot: AdditionInFlight = {
      ...snapshot,
      status: "requesting",
    };

    inFlightRef.current = retrySnapshot;

    setError(null);
    publishPendingAdditions();

    void sendSnapshot(retrySnapshot);
  }, [publishPendingAdditions, sendSnapshot]);

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

      reconciliationRef.current = null;
      publishPendingAdditions();
    },
    [publishPendingAdditions],
  );

  return {
    pendingAdditions,
    availableRevision,
    error,
    queueAddition,
    retry,
    confirmAvailableRevision,
  };
}
