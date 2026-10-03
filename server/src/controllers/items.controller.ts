import type { Request, Response } from "express";
import type {
  AvailableItemsPageRequest,
  SelectedItemsPageRequest,
  SelectionBatchResponse,
  SelectionBatchResult,
  AddItemBatchResult,
  AddItemsBatchResponse,
  ReadBatchResponse,
  ReadBatchResult,
} from "@inventory/shared";

import { itemStore } from "../services/item-store.js";
import { parseReadPageRequest } from "../services/read-request-parser.js";

const CURSOR_PATTERN = /^[1-9]\d{0,15}$/;
const SEARCH_PATTERN = /^[1-9]\d*$/;
const READ_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

type ValidatedSelectionBatchOperation = {
  id: number;
  selected: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSelectionBatch(
  body: unknown,
  res: Response,
): ValidatedSelectionBatchOperation[] | null {
  if (
    !isObject(body) ||
    !("operations" in body) ||
    !Array.isArray(body.operations) ||
    body.operations.length === 0
  ) {
    res.status(400).json({
      error: "INVALID_SELECTION_BATCH",
      message:
        "Не удалось обработать изменения выбора. Проверьте данные и попробуйте снова.",
    });

    return null;
  }

  const operations: ValidatedSelectionBatchOperation[] = [];
  const seenIds = new Set<number>();

  for (const value of body.operations) {
    if (
      !isObject(value) ||
      !("id" in value) ||
      typeof value.id !== "number" ||
      !Number.isSafeInteger(value.id) ||
      value.id <= 0 ||
      !("selected" in value) ||
      typeof value.selected !== "boolean"
    ) {
      res.status(400).json({
        error: "INVALID_SELECTION_OPERATION",
        message:
          "Не удалось обработать одно из изменений выбора. Проверьте данные и попробуйте снова.",
      });

      return null;
    }

    if (seenIds.has(value.id)) {
      res.status(400).json({
        error: "DUPLICATE_SELECTION_OPERATION",
        message:
          "Для одного элемента передано несколько изменений. Попробуйте снова.",
      });

      return null;
    }

    seenIds.add(value.id);

    operations.push({
      id: value.id,
      selected: value.selected,
    });
  }

  return operations;
}

export function updateSelectionBatch(req: Request, res: Response): void {
  if (!req.is("application/json")) {
    res.status(415).json({
      error: "UNSUPPORTED_MEDIA_TYPE",
      message: "Не удалось обработать изменения выбора. Попробуйте снова.",
    });

    return;
  }

  const operations = parseSelectionBatch(req.body, res);

  if (operations === null) {
    return;
  }

  const results: SelectionBatchResult[] = operations.map(({ id, selected }) => {
    const result = itemStore.setSelection(id, selected);

    if (result === "not_found") {
      return {
        id,
        selected,
        success: false,
        error: "ITEM_NOT_FOUND",
        message: "Элемент не найден.",
      };
    }

    return {
      id,
      selected,
      success: true,
    };
  });

  const response: SelectionBatchResponse = {
    results,
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
  res.json(itemStore.getAvailablePage(parsed.request));
}

// function parseItemId(value: unknown, res: Response): number | null {
//   if (typeof value !== "string" || !CURSOR_PATTERN.test(value)) {
//     res.status(400).json({
//       error: "INVALID_ID",
//       message: "Не удалось определить выбранный элемент.",
//     });

//     return null;
//   }

//   const id = Number(value);

//   if (!Number.isSafeInteger(id)) {
//     res.status(400).json({
//       error: "INVALID_ID",
//       message: "Не удалось определить выбранный элемент.",
//     });

//     return null;
//   }

//   return id;
// }

export function getSelectedItems(req: Request, res: Response): void {
  const parsed = parseReadPageRequest(req.query);

  if (!parsed.success) {
    res.status(400).json(parsed.failure);
    return;
  }

  const selectedRequest: SelectedItemsPageRequest = parsed.request;

  const page = itemStore.getSelectedPage(selectedRequest);

  if (page === null) {
    res.status(400).json({
      error: "INVALID_CURSOR",
      message:
        "Не удалось определить позицию в списке. Обновите страницу и попробуйте снова.",
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(page);
}
