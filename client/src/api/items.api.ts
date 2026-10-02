import { ApiRequestError, readApiErrorResponse } from "./api-error";

export type PageDirection = "forward" | "backward";

export type PageRequest = {
  direction: PageDirection;
  cursor: string | null;
};

export type AvailableItemsPage = {
  ids: number[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasNext: boolean;
  hasPrevious: boolean;
};

function isAvailableItemsPage(value: unknown): value is AvailableItemsPage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("ids" in value) ||
    !Array.isArray(value.ids) ||
    !("nextCursor" in value) ||
    !("prevCursor" in value) ||
    !("hasNext" in value) ||
    typeof value.hasNext !== "boolean" ||
    !("hasPrevious" in value) ||
    typeof value.hasPrevious !== "boolean"
  ) {
    return false;
  }

  const ids: unknown[] = value.ids;

  if (
    ids.length > 20 ||
    !ids.every(
      (id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0,
    )
  ) {
    return false;
  }

  if (ids.length === 0) {
    return (
      !value.hasNext &&
      !value.hasPrevious &&
      value.nextCursor === null &&
      value.prevCursor === null
    );
  }

  return (
    value.nextCursor === (value.hasNext ? String(ids[ids.length - 1]) : null) &&
    value.prevCursor === (value.hasPrevious ? String(ids[0]) : null)
  );
}

export async function getAvailableItems(
  signal: AbortSignal,
  request: PageRequest,
): Promise<AvailableItemsPage> {
  const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");

  if (!apiUrl) {
    throw new ApiRequestError(
      "CLIENT_CONFIGURATION_ERROR",
      "Приложение не настроено для подключения к серверу.",
    );
  }

  if (request.direction === "backward" && request.cursor === null) {
    throw new ApiRequestError(
      "CLIENT_VALIDATION_ERROR",
      "Не удалось определить нужную часть списка. Обновите страницу и попробуйте снова.",
    );
  }

  const query = new URLSearchParams({
    direction: request.direction,
  });

  if (request.cursor !== null) {
    query.set("cursor", request.cursor);
  }

  let response: Response;

  try {
    response = await fetch(`${apiUrl}/api/items/available?${query}`, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    throw new ApiRequestError(
      "NETWORK_ERROR",
      "Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.",
    );
  }

  if (!response.ok) {
    throw await readApiErrorResponse(
      response,
      "Не удалось выполнить запрос. Попробуйте снова.",
    );
  }

  let data: unknown;

  try {
    data = await response.json();
  } catch {
    throw new ApiRequestError(
      "INVALID_RESPONSE",
      "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
    );
  }

  if (!isAvailableItemsPage(data)) {
    throw new ApiRequestError(
      "INVALID_RESPONSE",
      "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
    );
  }

  const boundary = Number(request.cursor ?? 0);
  let previousId = 0;

  for (const id of data.ids) {
    if (
      id <= previousId ||
      (request.direction === "forward" ? id <= boundary : id >= boundary)
    ) {
      throw new ApiRequestError(
        "INVALID_PAGE_ORDER",
        "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
      );
    }

    previousId = id;
  }

  const hasContinuation =
    request.direction === "forward" ? data.hasNext : data.hasPrevious;

  if (hasContinuation && data.ids.length !== 20) {
    throw new ApiRequestError(
      "INVALID_PAGE_SIZE",
      "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
    );
  }

  return data;
}
