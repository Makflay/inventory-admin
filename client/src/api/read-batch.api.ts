import type {
  AvailableItemsPage,
  AvailableItemsPageRequest,
  ReadBatchOperation,
  ReadBatchRequest,
  ReadBatchResponse,
  ReadBatchResult,
  SelectedItemsPage,
  SelectedItemsPageRequest,
} from "@inventory/shared";

import { ApiRequestError, readApiErrorResponse } from "./api-error";

const PAGE_SIZE = 20;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasValidPageInfo(page: Record<string, unknown>): page is Record<
  string,
  unknown
> & {
  pageInfo: {
    startCursor: string | null;
    endCursor: string | null;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
} {
  if (!isObject(page.pageInfo)) {
    return false;
  }

  const pageInfo = page.pageInfo;

  return (
    isNullableString(pageInfo.startCursor) &&
    isNullableString(pageInfo.endCursor) &&
    typeof pageInfo.hasNextPage === "boolean" &&
    typeof pageInfo.hasPreviousPage === "boolean"
  );
}

function isAvailableItemsPage(
  value: unknown,
  request: AvailableItemsPageRequest,
): value is AvailableItemsPage {
  if (
    !isObject(value) ||
    !Array.isArray(value.ids) ||
    value.ids.length > PAGE_SIZE ||
    !hasValidPageInfo(value)
  ) {
    return false;
  }

  const ids = value.ids;
  let previousId = 0;
  const search = request.search ?? "";

  for (const id of ids) {
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      id <= previousId ||
      (search !== "" && !String(id).includes(search)) ||
      (request.after !== undefined && id <= Number(request.after)) ||
      (request.before !== undefined && id >= Number(request.before))
    ) {
      return false;
    }

    previousId = id;
  }

  if (ids.length === 0) {
    return (
      value.pageInfo.startCursor === null && value.pageInfo.endCursor === null
    );
  }

  return (
    value.pageInfo.startCursor === String(ids[0]) &&
    value.pageInfo.endCursor === String(ids[ids.length - 1])
  );
}

function isSelectedItemsPage(
  value: unknown,
  request: SelectedItemsPageRequest,
): value is SelectedItemsPage {
  if (
    !isObject(value) ||
    !Array.isArray(value.ids) ||
    value.ids.length > PAGE_SIZE ||
    !hasValidPageInfo(value)
  ) {
    return false;
  }

  const ids = value.ids;
  const uniqueIds = new Set<number>();
  const search = request.search ?? "";

  for (const id of ids) {
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      uniqueIds.has(id) ||
      (search !== "" && !String(id).includes(search))
    ) {
      return false;
    }

    uniqueIds.add(id);
  }

  if (ids.length === 0) {
    return (
      value.pageInfo.startCursor === null && value.pageInfo.endCursor === null
    );
  }

  return (
    value.pageInfo.startCursor === String(ids[0]) &&
    value.pageInfo.endCursor === String(ids[ids.length - 1])
  );
}

function isValidFailure(value: Record<string, unknown>): boolean {
  return (
    value.success === false &&
    typeof value.error === "string" &&
    value.error.trim().length > 0 &&
    typeof value.message === "string" &&
    value.message.trim().length > 0
  );
}

function isResultForOperation(
  value: unknown,
  operation: ReadBatchOperation,
): value is ReadBatchResult {
  if (
    !isObject(value) ||
    value.requestId !== operation.requestId ||
    typeof value.success !== "boolean"
  ) {
    return false;
  }

  if (!value.success) {
    return isValidFailure(value);
  }

  if (
    operation.type === "available" &&
    value.type === "available" &&
    isAvailableItemsPage(value.page, operation.request)
  ) {
    return true;
  }

  return (
    operation.type === "selected" &&
    value.type === "selected" &&
    isSelectedItemsPage(value.page, operation.request)
  );
}

function isReadBatchResponse(
  value: unknown,
  request: ReadBatchRequest,
): value is ReadBatchResponse {
  if (
    !isObject(value) ||
    !Array.isArray(value.results) ||
    value.results.length !== request.operations.length
  ) {
    return false;
  }

  const operationsById = new Map(
    request.operations.map((operation) => [operation.requestId, operation]),
  );

  const seenResults = new Set<string>();

  for (const result of value.results) {
    if (
      !isObject(result) ||
      typeof result.requestId !== "string" ||
      seenResults.has(result.requestId)
    ) {
      return false;
    }

    const operation = operationsById.get(result.requestId);

    if (operation === undefined || !isResultForOperation(result, operation)) {
      return false;
    }

    seenResults.add(result.requestId);
  }

  return seenResults.size === request.operations.length;
}

export async function executeReadBatch(
  signal: AbortSignal,
  request: ReadBatchRequest,
): Promise<ReadBatchResponse> {
  const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");

  if (!apiUrl) {
    throw new ApiRequestError(
      "CLIENT_CONFIGURATION_ERROR",
      "Приложение не настроено для подключения к серверу.",
    );
  }

  let response: Response;

  try {
    response = await fetch(`${apiUrl}/api/items/read-batch`, {
      method: "POST",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
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
      "Не удалось загрузить элементы. Попробуйте снова.",
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

  if (!isReadBatchResponse(data, request)) {
    throw new ApiRequestError(
      "INVALID_RESPONSE",
      "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
    );
  }

  return data;
}
