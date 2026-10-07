import type { Request, Response } from "express";
import type {
  SelectedItemsPageRequest,
  SelectionBatchResponse,
  SelectionBatchResult,
  AddItemBatchResult,
  AddItemsBatchResponse,
  ReadBatchResponse,
  ReadBatchResult,
  ReorderSelectedOperation,
  StaleServerVersionResponse,
} from "@inventory/shared";

import { itemStore } from "../services/item-store.js";
import { parseReadPageRequest } from "../services/read-request-parser.js";
import { parseSelectionBatchRequest } from "../services/selection-batch-parser.js";

const READ_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reorderFailure(
  operation: ReorderSelectedOperation,
  result: Exclude<
    ReturnType<typeof itemStore.reorderSelected>,
    "updated" | "unchanged"
  >,
): SelectionBatchResult {
  const failures = {
    dragged_not_selected: {
      error: "DRAGGED_NOT_SELECTED",
      message: "Перемещаемый элемент больше не выбран.",
    },
    target_not_selected: {
      error: "TARGET_NOT_SELECTED",
      message:
        "Элемент, рядом с которым выполняется перемещение, больше не выбран.",
    },
    dragged_not_matching_search: {
      error: "DRAGGED_NOT_MATCHING_SEARCH",
      message: "Перемещаемый элемент больше не входит в текущий список.",
    },
    target_not_matching_search: {
      error: "TARGET_NOT_MATCHING_SEARCH",
      message:
        "Элемент, рядом с которым выполняется перемещение, больше не входит в текущий список.",
    },
    same_item: {
      error: "SAME_REORDER_ITEM",
      message: "Элемент нельзя переместить относительно самого себя.",
    },
  } as const;

  return {
    ...operation,
    success: false,
    ...failures[result],
  };
}

export function updateSelectionBatch(req: Request, res: Response): void {
  if (!req.is("application/json")) {
    res.status(415).json({
      error: "UNSUPPORTED_MEDIA_TYPE",
      message: "Не удалось обработать изменения выбора. Попробуйте снова.",
    });

    return;
  }

  const parsedBatch = parseSelectionBatchRequest(req.body);

  if (!parsedBatch.success) {
    res.status(parsedBatch.failure.status).json({
      error: parsedBatch.failure.error,
      message: parsedBatch.failure.message,
    });

    return;
  }

  const batch = parsedBatch.batch;

  const containsReorder = batch.operations.some(
    (operation) => operation.kind === "reorder_selected",
  );

  if (
    containsReorder &&
    batch.baseServerVersion !== itemStore.getServerVersion()
  ) {
    const response: StaleServerVersionResponse = {
      error: "STALE_SERVER_VERSION",
      message:
        "Порядок выбранных элементов изменился. Дождитесь обновления списка и повторите действие.",
      serverVersion: itemStore.getServerVersion(),
    };

    res.setHeader("Cache-Control", "no-store");
    res.status(409).json(response);
    return;
  }

  const results: SelectionBatchResult[] = [];

  for (const operation of batch.operations) {
    if (operation.kind === "set_selection") {
      const result = itemStore.setSelection(operation.id, operation.selected);

      if (result === "not_found") {
        results.push({
          ...operation,
          success: false,
          error: "ITEM_NOT_FOUND",
          message: "Элемент не найден.",
        });
      } else {
        results.push({
          ...operation,
          success: true,
        });
      }

      continue;
    }
    const result = itemStore.reorderSelected(
      operation.draggedId,
      operation.targetId,
      operation.placement,
      operation.search,
    );

    if (result === "updated" || result === "unchanged") {
      results.push({
        ...operation,
        success: true,
        changed: result === "updated",
      });
    } else {
      results.push(reorderFailure(operation, result));
    }
  }

  const response: SelectionBatchResponse = {
    results,
    serverVersion: itemStore.getServerVersion(),
  };

  res.setHeader("Cache-Control", "no-store");
  res.json(response);
}

export function addItems(req: Request, res: Response): void {
  if (!req.is("application/json")) {
    res.status(415).json({
      error: "UNSUPPORTED_MEDIA_TYPE",
      message: "Не удалось обработать отправленные данные. Попробуйте снова.",
    });
    return;
  }

  if (
    !isObject(req.body) ||
    !("ids" in req.body) ||
    !Array.isArray(req.body.ids) ||
    req.body.ids.length === 0
  ) {
    res.status(400).json({
      error: "INVALID_ADDITION_BATCH",
      message:
        "Не удалось обработать список добавляемых элементов. Проверьте данные и попробуйте снова.",
    });
    return;
  }

  const ids: unknown[] = req.body.ids;

  if (ids.some((id) => typeof id !== "number")) {
    res.status(400).json({
      error: "INVALID_ADDITION_BATCH",
      message:
        "Не удалось обработать список добавляемых элементов. Проверьте данные и попробуйте снова.",
    });

    return;
  }

  const numericIds = ids as number[];
  const seenIds = new Set<number>();

  for (const id of numericIds) {
    if (seenIds.has(id)) {
      res.status(400).json({
        error: "DUPLICATE_ADDITION_ID",
        message:
          "Один и тот же элемент указан несколько раз. Удалите повторения и попробуйте снова.",
      });

      return;
    }

    seenIds.add(id);
  }

  const results: AddItemBatchResult[] = numericIds.map((id) => {
    if (!Number.isSafeInteger(id) || id <= 0) {
      return {
        id,
        status: "rejected",
        error: "INVALID_ID",
        message: "ID должен быть положительным целым числом.",
      };
    }

    const status = itemStore.add(id);

    return {
      id,
      status,
    };
  });

  const response: AddItemsBatchResponse = {
    results,
    serverVersion: itemStore.getServerVersion(),
  };

  res.setHeader("Cache-Control", "no-store");
  res.json(response);
}

export function readItemsBatch(req: Request, res: Response): void {
  if (!req.is("application/json")) {
    res.status(415).json({
      error: "UNSUPPORTED_MEDIA_TYPE",
      message: "Не удалось обработать запрос списка. Попробуйте снова.",
    });

    return;
  }

  if (
    !isObject(req.body) ||
    !("operations" in req.body) ||
    !Array.isArray(req.body.operations) ||
    req.body.operations.length === 0
  ) {
    res.status(400).json({
      error: "INVALID_READ_BATCH",
      message: "Не удалось обработать запрос списка. Попробуйте снова.",
    });

    return;
  }

  const serverVersion = itemStore.getServerVersion();
  const rawOperations: unknown[] = req.body.operations;
  const requestIds = new Set<string>();

  for (const operation of rawOperations) {
    if (
      !isObject(operation) ||
      typeof operation.requestId !== "string" ||
      !READ_REQUEST_ID_PATTERN.test(operation.requestId) ||
      requestIds.has(operation.requestId)
    ) {
      res.status(400).json({
        error: "INVALID_READ_BATCH_IDENTITY",
        message: "Не удалось сопоставить запросы списка. Попробуйте снова.",
      });

      return;
    }

    requestIds.add(operation.requestId);
  }

  const results: ReadBatchResult[] = rawOperations.map((rawOperation) => {
    const operation = rawOperation as Record<string, unknown>;
    const requestId = operation.requestId as string;

    if (operation.type !== "available" && operation.type !== "selected") {
      return {
        requestId,
        success: false,
        error: "UNSUPPORTED_READ_TYPE",
        message:
          "Не удалось определить запрашиваемый список. Попробуйте снова.",
      };
    }

    const parsed = parseReadPageRequest(operation.request);

    if (!parsed.success) {
      return {
        requestId,
        success: false,
        error: parsed.failure.error,
        message: parsed.failure.message,
      };
    }

    if (operation.type === "available") {
      return {
        requestId,
        type: "available",
        success: true,
        page: itemStore.getAvailablePage(parsed.request),
      };
    }

    const selectedRequest: SelectedItemsPageRequest = parsed.request;

    const page = itemStore.getSelectedPage(selectedRequest);

    if (page === null) {
      return {
        requestId,
        success: false,
        error: "INVALID_CURSOR",
        message:
          "Не удалось определить позицию в списке. Обновите страницу и попробуйте снова.",
      };
    }

    return {
      requestId,
      type: "selected",
      success: true,
      page,
    };
  });

  const response: ReadBatchResponse = {
    results,
    serverVersion,
  };

  res.setHeader("Cache-Control", "no-store");
  res.json(response);
}

export function getAvailableItems(req: Request, res: Response): void {
  const parsed = parseReadPageRequest(req.query);

  if (!parsed.success) {
    res.status(400).json(parsed.failure);
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(itemStore.getAvailableSnapshot(parsed.request));
}

export function getSelectedItems(req: Request, res: Response): void {
  const parsed = parseReadPageRequest(req.query);

  if (!parsed.success) {
    res.status(400).json(parsed.failure);
    return;
  }

  const snapshot = itemStore.getSelectedSnapshot(parsed.request);

  if (snapshot === null) {
    res.status(400).json({
      error: "INVALID_CURSOR",
      message:
        "Не удалось определить позицию в списке. Обновите страницу и попробуйте снова.",
    });

    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(snapshot);
}
