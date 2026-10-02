import type { Request, Response } from "express";
import type { AvailableItemsPageRequest } from "@inventory/shared";

import { itemStore } from "../services/item-store.js";

const MAX_IDS_PER_REQUEST = 1000;

const CURSOR_PATTERN = /^[1-9]\d{0,15}$/;
const SEARCH_PATTERN = /^[1-9]\d*$/;

function parseCursor(
  value: unknown,
  parameter: "after" | "before",
  res: Response,
): string | null {
  if (typeof value !== "string" || !CURSOR_PATTERN.test(value)) {
    res.status(400).json({
      error: "INVALID_CURSOR",
      message:
        "Не удалось определить позицию в списке. Обновите страницу и попробуйте снова.",
      parameter,
    });

    return null;
  }

  const cursor = Number(value);

  if (!Number.isSafeInteger(cursor)) {
    res.status(400).json({
      error: "INVALID_CURSOR",
      message:
        "Не удалось определить позицию в списке. Обновите страницу и попробуйте снова.",
      parameter,
    });

    return null;
  }

  return value;
}

function parseSearch(value: unknown, res: Response): string | null {
  if (value === undefined || value === "") {
    return "";
  }

  if (typeof value !== "string" || !SEARCH_PATTERN.test(value)) {
    res.status(400).json({
      error: "INVALID_SEARCH",
      message:
        "Введите последовательность цифр без ведущих нулей или очистите поле поиска.",
    });

    return null;
  }

  return value;
}

export function addItems(req: Request, res: Response): void {
  if (!req.is("application/json")) {
    res.status(415).json({
      error: "UNSUPPORTED_MEDIA_TYPE",
      message: "Не удалось обработать отправленные данные. Попробуйте снова.",
    });
    return;
  }

  const body: unknown = req.body;

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("ids" in body) ||
    !Array.isArray(body.ids)
  ) {
    res.status(400).json({
      error: "INVALID_BODY",
      message:
        "Не удалось обработать список ID. Проверьте данные и попробуйте снова.",
    });
    return;
  }

  const ids: unknown[] = body.ids;

  if (ids.length === 0 || ids.length > MAX_IDS_PER_REQUEST) {
    res.status(400).json({
      error: "INVALID_IDS_COUNT",
      message: `Укажите от 1 до ${MAX_IDS_PER_REQUEST} ID`,
    });
    return;
  }

  const validatedIds: number[] = [];

  for (const [index, id] of ids.entries()) {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({
        error: "INVALID_ID",
        message: "Каждый ID должен быть положительным целым числом.",
        index,
      });
      return;
    }

    validatedIds.push(id);
  }

  const incomingIds = new Set<number>();
  const conflictingIds = new Set<number>();

  for (const id of validatedIds) {
    if (itemStore.exists(id) || incomingIds.has(id)) {
      conflictingIds.add(id);
    }

    incomingIds.add(id);
  }

  if (conflictingIds.size > 0) {
    res.status(409).json({
      error: "ID_CONFLICT",
      message: "Некоторые ID уже существуют или повторяются в списке.",
      conflictingIds: [...conflictingIds],
    });
    return;
  }

  itemStore.addMany(incomingIds);

  res.status(201).json({
    addedIds: [...incomingIds],
    addedCount: incomingIds.size,
  });
}

export function getAvailableItems(req: Request, res: Response): void {
  const unsupportedParams = Object.keys(req.query).filter(
    (key) => key !== "search" && key !== "after" && key !== "before",
  );

  if (unsupportedParams.length > 0) {
    res.status(400).json({
      error: "INVALID_QUERY",
      message:
        "Не удалось загрузить список. Обновите страницу и попробуйте снова.",
      parameters: unsupportedParams,
    });
    return;
  }

  const rawAfter = req.query.after;
  const rawBefore = req.query.before;

  const search = parseSearch(req.query.search, res);

  if (search === null) {
    return;
  }

  if (rawAfter !== undefined && rawBefore !== undefined) {
    res.status(400).json({
      error: "INVALID_PAGINATION",
      message:
        "Не удалось определить нужную часть списка. Обновите страницу и попробуйте снова.",
    });
    return;
  }

  let pagination: AvailableItemsPageRequest;

  if (rawAfter !== undefined) {
    const after = parseCursor(rawAfter, "after", res);

    if (after === null) {
      return;
    }

    pagination = { search, after };
  } else if (rawBefore !== undefined) {
    const before = parseCursor(rawBefore, "before", res);

    if (before === null) {
      return;
    }

    pagination = { search, before };
  } else {
    pagination = { search };
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(itemStore.getAvailablePage(pagination));
}

function parseItemId(value: unknown, res: Response): number | null {
  if (typeof value !== "string" || !CURSOR_PATTERN.test(value)) {
    res.status(400).json({
      error: "INVALID_ID",
      message: "Не удалось определить выбранный элемент.",
    });

    return null;
  }

  const id = Number(value);

  if (!Number.isSafeInteger(id)) {
    res.status(400).json({
      error: "INVALID_ID",
      message: "Не удалось определить выбранный элемент.",
    });

    return null;
  }

  return id;
}

export function getSelectedItems(_req: Request, res: Response): void {
  res.setHeader("Cache-Control", "no-store");

  res.json({
    ids: itemStore.getSelectedItems(),
  });
}

export function selectItem(req: Request, res: Response): void {
  const id = parseItemId(req.params.id, res);

  if (id === null) {
    return;
  }

  const result = itemStore.selectItem(id);

  if (result === "not_found") {
    res.status(404).json({
      error: "ITEM_NOT_FOUND",
      message: "Элемент не найден.",
    });
    return;
  }

  if (result === "already_selected") {
    res.status(409).json({
      error: "ITEM_ALREADY_SELECTED",
      message: "Элемент уже выбран.",
    });
    return;
  }

  res.json({
    ids: itemStore.getSelectedItems(),
  });
}

export function unselectItem(req: Request, res: Response): void {
  const id = parseItemId(req.params.id, res);

  if (id === null) {
    return;
  }

  const result = itemStore.unselectItem(id);

  if (result === "not_selected") {
    res.status(409).json({
      error: "ITEM_NOT_SELECTED",
      message: "Элемент уже не находится в выбранных.",
    });
    return;
  }

  res.json({
    ids: itemStore.getSelectedItems(),
  });
}
