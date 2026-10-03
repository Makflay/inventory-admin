import type {
  AvailableItemsPage,
  AvailableItemsPageRequest,
  ReadBatchOperation,
  ReadBatchResult,
  SelectedItemsPage,
  SelectedItemsPageRequest,
} from "@inventory/shared";

import { ApiRequestError } from "../api/api-error";
import { executeReadBatch } from "../api/read-batch.api";

const COOLDOWN_MS = 1_000;

export type ReadPagination =
  | { mode: "initial" }
  | { mode: "after"; cursor: string }
  | { mode: "before"; cursor: string };

export type ReadDescriptor =
  | {
      type: "available";
      search: string;
      pagination: ReadPagination;
      freshnessToken: string;
    }
  | {
      type: "selected";
      search: string;
      pagination: ReadPagination;
      freshnessToken: string;
    };

type ReadPage = AvailableItemsPage | SelectedItemsPage;
type SchedulerState = "idle" | "leading-scheduled" | "cooldown";

type Consumer = {
  active: boolean;
  signal: AbortSignal;
  abortListener: () => void;
  resolve: (page: ReadPage) => void;
  reject: (error: unknown) => void;
};

type LogicalReadEntry = {
  key: string;
  requestId: string;
  descriptor: ReadDescriptor;
  state: "queued" | "inFlight";
  batchId: number | null;
  consumers: Map<symbol, Consumer>;
};

type PhysicalBatchEntry = {
  key: string;
  requestId: string;
  batchId: number;
};

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function createStableKey(descriptor: ReadDescriptor): string {
  const prefix =
    `${descriptor.type}` + `|search:${encodePart(descriptor.search)}`;

  const pagination =
    descriptor.pagination.mode === "initial"
      ? "|initial"
      : `|${descriptor.pagination.mode}:` +
        encodePart(descriptor.pagination.cursor);

  return (
    prefix + pagination + `|fresh:${encodePart(descriptor.freshnessToken)}`
  );
}

function requestToPagination(
  request: AvailableItemsPageRequest | SelectedItemsPageRequest,
): ReadPagination {
  if (request.after !== undefined) {
    return {
      mode: "after",
      cursor: request.after,
    };
  }

  if (request.before !== undefined) {
    return {
      mode: "before",
      cursor: request.before,
    };
  }

  return {
    mode: "initial",
  };
}

function descriptorToOperation(entry: LogicalReadEntry): ReadBatchOperation {
  const { descriptor } = entry;

  const pagination =
    descriptor.pagination.mode === "initial"
      ? {}
      : descriptor.pagination.mode === "after"
        ? { after: descriptor.pagination.cursor }
        : { before: descriptor.pagination.cursor };

  if (descriptor.type === "available") {
    return {
      requestId: entry.requestId,
      type: "available",
      request: {
        search: descriptor.search,
        ...pagination,
      },
    };
  }

  return {
    requestId: entry.requestId,
    type: "selected",
    request: {
      search: descriptor.search,
      ...pagination,
    },
  };
}

class ReadRequestManager {
  private readonly entriesByKey = new Map<string, LogicalReadEntry>();

  private readonly queuedKeys = new Set<string>();

  private schedulerState: SchedulerState = "idle";
  private cooldownTimer: number | null = null;

  private requestId = 0;
  private batchId = 0;

  readAvailable(
    signal: AbortSignal,
    request: AvailableItemsPageRequest,
    freshnessToken: string,
  ): Promise<AvailableItemsPage> {
    const descriptor: ReadDescriptor = {
      type: "available",
      search: request.search ?? "",
      pagination: requestToPagination(request),
      freshnessToken,
    };

    return this.subscribe(descriptor, signal) as Promise<AvailableItemsPage>;
  }

  readSelected(
    signal: AbortSignal,
    request: SelectedItemsPageRequest,
    freshnessToken: string,
  ): Promise<SelectedItemsPage> {
    const descriptor: ReadDescriptor = {
      type: "selected",
      search: request.search ?? "",
      pagination: requestToPagination(request),
      freshnessToken,
    };

    return this.subscribe(descriptor, signal) as Promise<SelectedItemsPage>;
  }

  private subscribe(
    descriptor: ReadDescriptor,
    signal: AbortSignal,
  ): Promise<ReadPage> {
    if (signal.aborted) {
      return Promise.reject(abortError());
    }

    const key = createStableKey(descriptor);

    let entry = this.entriesByKey.get(key);

    if (entry === undefined) {
      entry = {
        key,
        requestId: `read-${++this.requestId}`,
        descriptor,
        state: "queued",
        batchId: null,
        consumers: new Map(),
      };

      this.entriesByKey.set(key, entry);
      this.queuedKeys.add(key);
      this.schedule();
    }

    const consumerId = Symbol(key);

    return new Promise<ReadPage>((resolve, reject) => {
      const abortListener = () => {
        const currentEntry = this.entriesByKey.get(key);
        const consumer = currentEntry?.consumers.get(consumerId);

        if (
          currentEntry === undefined ||
          consumer === undefined ||
          !consumer.active
        ) {
          return;
        }

        consumer.active = false;
        currentEntry.consumers.delete(consumerId);
        signal.removeEventListener("abort", abortListener);
        reject(abortError());

        if (
          currentEntry.state === "queued" &&
          currentEntry.consumers.size === 0
        ) {
          this.queuedKeys.delete(key);
          this.entriesByKey.delete(key);
        }
      };

      const consumer: Consumer = {
        active: true,
        signal,
        abortListener,
        resolve,
        reject,
      };

      entry.consumers.set(consumerId, consumer);

      signal.addEventListener("abort", abortListener, {
        once: true,
      });
    });
  }

  private schedule(): void {
    if (this.schedulerState !== "idle") {
      return;
    }

    this.schedulerState = "leading-scheduled";

    queueMicrotask(() => {
      if (this.schedulerState !== "leading-scheduled") {
        return;
      }

      this.dispatchQueued();
    });
  }

  private dispatchQueued(): void {
    const entries: LogicalReadEntry[] = [];

    for (const key of this.queuedKeys) {
      const entry = this.entriesByKey.get(key);

      if (
        entry === undefined ||
        entry.state !== "queued" ||
        entry.consumers.size === 0
      ) {
        continue;
      }

      entries.push(entry);
    }

    this.queuedKeys.clear();

    if (entries.length === 0) {
      this.schedulerState = "idle";
      return;
    }

    const batchId = ++this.batchId;

    const snapshot: PhysicalBatchEntry[] = entries.map((entry) => {
      entry.state = "inFlight";
      entry.batchId = batchId;

      return {
        key: entry.key,
        requestId: entry.requestId,
        batchId,
      };
    });

    const operations = entries.map(descriptorToOperation);
    const controller = new AbortController();

    this.startCooldown();

    void executeReadBatch(controller.signal, {
      operations,
    }).then(
      (response) => {
        const resultsById = new Map(
          response.results.map((result) => [result.requestId, result]),
        );

        for (const item of snapshot) {
          const result = resultsById.get(item.requestId);

          if (result === undefined) {
            this.rejectEntry(
              item,
              new ApiRequestError(
                "INVALID_RESPONSE",
                "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
              ),
            );

            continue;
          }

          this.settleEntry(item, result);
        }
      },
      (error: unknown) => {
        for (const item of snapshot) {
          this.rejectEntry(item, error);
        }
      },
    );
  }

  private startCooldown(): void {
    this.schedulerState = "cooldown";

    if (this.cooldownTimer !== null) {
      window.clearTimeout(this.cooldownTimer);
    }

    this.cooldownTimer = window.setTimeout(() => {
      this.cooldownTimer = null;

      if (this.queuedKeys.size === 0) {
        this.schedulerState = "idle";
        return;
      }

      this.dispatchQueued();
    }, COOLDOWN_MS);
  }

  private settleEntry(
    batchEntry: PhysicalBatchEntry,
    result: ReadBatchResult,
  ): void {
    const entry = this.takeEntry(batchEntry);

    if (entry === null) {
      return;
    }

    if (!result.success) {
      this.rejectConsumers(
        entry,
        new ApiRequestError(result.error, result.message),
      );

      return;
    }

    this.resolveConsumers(entry, result.page);
  }

  private rejectEntry(batchEntry: PhysicalBatchEntry, error: unknown): void {
    const entry = this.takeEntry(batchEntry);

    if (entry === null) {
      return;
    }

    this.rejectConsumers(entry, error);
  }

  private takeEntry(batchEntry: PhysicalBatchEntry): LogicalReadEntry | null {
    const entry = this.entriesByKey.get(batchEntry.key);

    if (
      entry === undefined ||
      entry.requestId !== batchEntry.requestId ||
      entry.batchId !== batchEntry.batchId
    ) {
      return null;
    }

    this.entriesByKey.delete(entry.key);
    this.queuedKeys.delete(entry.key);

    return entry;
  }

  private resolveConsumers(entry: LogicalReadEntry, page: ReadPage): void {
    const consumers = [...entry.consumers.values()];
    entry.consumers.clear();

    for (const consumer of consumers) {
      consumer.signal.removeEventListener("abort", consumer.abortListener);

      if (!consumer.active || consumer.signal.aborted) {
        continue;
      }

      consumer.active = false;
      consumer.resolve(page);
    }
  }

  private rejectConsumers(entry: LogicalReadEntry, error: unknown): void {
    const consumers = [...entry.consumers.values()];
    entry.consumers.clear();

    for (const consumer of consumers) {
      consumer.signal.removeEventListener("abort", consumer.abortListener);

      if (!consumer.active || consumer.signal.aborted) {
        continue;
      }

      consumer.active = false;
      consumer.reject(error);
    }
  }
}

export const readRequestManager = new ReadRequestManager();
