import type {
  AvailableItemsPage,
  AvailableItemsPageRequest,
} from "@inventory/shared";

import { ApiRequestError, readApiErrorResponse } from "./api-error";

const PAGE_SIZE = 20;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAvailableItemsPage(value: unknown): value is AvailableItemsPage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("ids" in value) ||
    !Array.isArray(value.ids) ||
    !("pageInfo" in value) ||
    typeof value.pageInfo !== "object" ||
    value.pageInfo === null
  ) {
    return false;
  }

  const ids: unknown[] = value.ids;
  const pageInfo = value.pageInfo;

  if (
    ids.length > PAGE_SIZE ||
    !ids.every(
      (id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0,
    ) ||
    !("startCursor" in pageInfo) ||
    !isNullableString(pageInfo.startCursor) ||
    !("endCursor" in pageInfo) ||
    !isNullableString(pageInfo.endCursor) ||
    !("hasNextPage" in pageInfo) ||
    typeof pageInfo.hasNextPage !== "boolean" ||
    !("hasPreviousPage" in pageInfo) ||
    typeof pageInfo.hasPreviousPage !== "boolean"
  ) {
    return false;
  }

  if (ids.length === 0) {
    return pageInfo.startCursor === null && pageInfo.endCursor === null;
  }

  return (
    pageInfo.startCursor === String(ids[0]) &&
    pageInfo.endCursor === String(ids[ids.length - 1])
  );
}

function validatePageOrder(
  page: AvailableItemsPage,
  request: AvailableItemsPageRequest,
): void {
  let previousId = 0;
  const search = request.search ?? "";

  for (const id of page.ids) {
    if (
      id <= previousId ||
      (search !== "" && !String(id).includes(search)) ||
      (request.after !== undefined && id <= Number(request.after)) ||
      (request.before !== undefined && id >= Number(request.before))
    ) {
      throw new ApiRequestError(
        "INVALID_PAGE_ORDER",
        "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
      );
    }

    previousId = id;
  }

  const hasRequestedContinuation =
    request.before !== undefined
      ? page.pageInfo.hasPreviousPage
      : page.pageInfo.hasNextPage;

  if (hasRequestedContinuation && page.ids.length !== PAGE_SIZE) {
    throw new ApiRequestError(
      "INVALID_PAGE_SIZE",
      "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
    );
  }
}

export async function getAvailableItems(
  signal: AbortSignal,
  request: AvailableItemsPageRequest,
): Promise<AvailableItemsPage> {
  const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");

  if (!apiUrl) {
    throw new ApiRequestError(
      "CLIENT_CONFIGURATION_ERROR",
      "Приложение не настроено для подключения к серверу.",
    );
  }

  if (request.after !== undefined && request.before !== undefined) {
    throw new ApiRequestError(
      "CLIENT_VALIDATION_ERROR",
      "Не удалось определить нужную часть списка. Обновите страницу и попробуйте снова.",
    );
  }

  const query = new URLSearchParams();

  if (request.search !== undefined) {
    query.set("search", request.search);
  }

  if (request.after !== undefined) {
    query.set("after", request.after);
  }

  if (request.before !== undefined) {
    query.set("before", request.before);
  }

  const queryString = query.toString();
  const url = `${apiUrl}/api/items/available${
    queryString.length > 0 ? `?${queryString}` : ""
  }`;

  let response: Response;

  try {
    response = await fetch(url, {
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

  validatePageOrder(data, request);

  return data;
}
