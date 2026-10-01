import type { Request, Response } from "express";

import { itemStore } from "../services/item-store.js";

const MAX_IDS_PER_REQUEST = 1000;

export function addItems(req: Request, res: Response): void {
  if (!req.is("application/json")) {
    res.status(415).json({
      error: "UNSUPPORTED_MEDIA_TYPE",
      message: "Используй Content-Type: application/json",
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
      message: "Ожидается объект с массивом ids",
    });
    return;
  }

  const ids: unknown[] = body.ids;

  if (ids.length === 0 || ids.length > MAX_IDS_PER_REQUEST) {
    res.status(400).json({
      error: "INVALID_IDS_COUNT",
      message: `Передай от 1 до ${MAX_IDS_PER_REQUEST} ID`,
    });
    return;
  }

  const validatedIds: number[] = [];

  for (const [index, id] of ids.entries()) {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({
        error: "INVALID_ID",
        message: "ID должен быть положительным безопасным целым числом",
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
      message: "ID уже существуют или повторяются внутри запроса",
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
