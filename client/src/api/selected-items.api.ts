import type {
  SelectionBatchRequest,
  SelectionBatchResponse,
  SelectionBatchResult,
  SelectionMutationOperation,
  StaleServerVersionResponse,
} from "@inventory/shared";

import { ApiRequestError, readApiErrorResponse } from "./api-error";
import { isValidServerVersion } from "../services/server-version";

//const PAGE_SIZE = 20;

export class SelectionBatchRejectedError extends ApiRequestError {
  constructor(error: string, message: string) {
    super(error, message);
    this.name = "SelectionBatchRejectedError";
  }
}

export class StaleServerVersionError extends ApiRequestError {
  readonly serverVersion: number;

  constructor(response: StaleServerVersionResponse) {
    super(response.error, response.message);
    this.name = "StaleServerVersionError";
    this.serverVersion = response.serverVersion;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStaleServerVersionResponse(
  value: unknown,
): value is StaleServerVersionResponse {
  return (
    isObject(value) &&
    value.error === "STALE_SERVER_VERSION" &&
    typeof value.message === "string" &&
    value.message.trim().length > 0 &&
    isValidServerVersion(value.serverVersion)
  );
}

function resultMatchesOperation(
  result: SelectionBatchResult,
  operation: SelectionMutationOperation,
): boolean {
  if (result.kind !== operation.kind) {
    return false;
  }

  if (operation.kind === "set_selection") {
    return (
      result.kind === "set_selection" &&
      result.id === operation.id &&
      result.selected === operation.selected
    );
  }

  return (
    result.kind === "reorder_selected" &&
    result.draggedId === operation.draggedId &&
    result.targetId === operation.targetId &&
    result.placement === operation.placement &&
    result.search === operation.search
  );
}

function isSelectionBatchResult(value: unknown): value is SelectionBatchResult {
  if (
    !isObject(value) ||
    (value.kind !== "set_selection" && value.kind !== "reorder_selected") ||
    typeof value.success !== "boolean"
  ) {
    return false;
  }

  if (value.kind === "set_selection") {
    if (
      !Number.isSafeInteger(value.id) ||
      (value.id as number) <= 0 ||
      typeof value.selected !== "boolean"
    ) {
      return false;
    }
  } else if (
    !Number.isSafeInteger(value.draggedId) ||
    (value.draggedId as number) <= 0 ||
    !Number.isSafeInteger(value.targetId) ||
    (value.targetId as number) <= 0 ||
    (value.placement !== "before" && value.placement !== "after") ||
    typeof value.search !== "string"
  ) {
    return false;
  }

  if (!value.success) {
    return (
      typeof value.error === "string" &&
      value.error.trim().length > 0 &&
      typeof value.message === "string" &&
      value.message.trim().length > 0
    );
  }

  return (
    value.kind !== "reorder_selected" || typeof value.changed === "boolean"
  );
}

function isSelectionBatchResponse(
  value: unknown,
  request: SelectionBatchRequest,
): value is SelectionBatchResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("results" in value) ||
    !Array.isArray(value.results) ||
    value.results.length !== request.operations.length ||
    !("serverVersion" in value) ||
    !isValidServerVersion(value.serverVersion)
  ) {
    return false;
  }

  return value.results.every((result, index) => {
    const operation = request.operations[index];

    return (
      operation !== undefined &&
      isSelectionBatchResult(result) &&
      resultMatchesOperation(result, operation)
    );
  });
}

export async function updateSelectionBatch(
  request: SelectionBatchRequest,
): Promise<SelectionBatchResponse> {
  let response: Response;

  try {
    response = await fetch(`${getApiUrl()}/api/items/selection-batch`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  } catch {
    throw new ApiRequestError(
      "NETWORK_ERROR",
      "Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.",
    );
  }

  if (response.status === 409) {
    const data = await parseJson(response);

    if (isStaleServerVersionResponse(data)) {
      throw new StaleServerVersionError(data);
    }

    throw new ApiRequestError(
      "INVALID_RESPONSE",
      "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
    );
  }

  if (!response.ok) {
    const error = await readApiErrorResponse(
      response,
      "Не удалось сохранить изменения выбора. Попробуйте снова.",
    );

    if (response.status >= 400 && response.status < 500) {
      throw new SelectionBatchRejectedError(error.error, error.message);
    }

    throw error;
  }

  const data = await parseJson(response);

  if (!isSelectionBatchResponse(data, request)) {
    throw new ApiRequestError(
      "INVALID_RESPONSE",
      "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
    );
  }

  return data;
}

// function isNullableString(value: unknown): value is string | null {
//   return value === null || typeof value === "string";
// }

// function isSelectedItemsPage(value: unknown): value is SelectedItemsPage {
//   if (
//     typeof value !== "object" ||
//     value === null ||
//     !("ids" in value) ||
//     !Array.isArray(value.ids) ||
//     !("pageInfo" in value) ||
//     typeof value.pageInfo !== "object" ||
//     value.pageInfo === null
//   ) {
//     return false;
//   }

//   const ids: unknown[] = value.ids;
//   const pageInfo = value.pageInfo;
//   const uniqueIds = new Set<number>();

//   for (const id of ids) {
//     if (
//       typeof id !== "number" ||
//       !Number.isSafeInteger(id) ||
//       id <= 0 ||
//       uniqueIds.has(id)
//     ) {
//       return false;
//     }

//     uniqueIds.add(id);
//   }

//   if (
//     ids.length > PAGE_SIZE ||
//     !("startCursor" in pageInfo) ||
//     !isNullableString(pageInfo.startCursor) ||
//     !("endCursor" in pageInfo) ||
//     !isNullableString(pageInfo.endCursor) ||
//     !("hasNextPage" in pageInfo) ||
//     typeof pageInfo.hasNextPage !== "boolean" ||
//     !("hasPreviousPage" in pageInfo) ||
//     typeof pageInfo.hasPreviousPage !== "boolean"
//   ) {
//     return false;
//   }

//   if (ids.length === 0) {
//     return pageInfo.startCursor === null && pageInfo.endCursor === null;
//   }

//   return (
//     pageInfo.startCursor === String(ids[0]) &&
//     pageInfo.endCursor === String(ids[ids.length - 1])
//   );
// }

// function isSelectionMutationResponse(
//   value: unknown,
// ): value is SelectionMutationResponse {
//   return (
//     typeof value === "object" &&
//     value !== null &&
//     "id" in value &&
//     typeof value.id === "number" &&
//     Number.isSafeInteger(value.id) &&
//     value.id > 0 &&
//     "selected" in value &&
//     typeof value.selected === "boolean"
//   );
// }

function getApiUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");

  if (!apiUrl) {
    throw new ApiRequestError(
      "CLIENT_CONFIGURATION_ERROR",
      "Приложение не настроено для подключения к серверу.",
    );
  }

  return apiUrl;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiRequestError(
      "INVALID_RESPONSE",
      "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
    );
  }
}

// export async function getSelectedItems(
//   signal: AbortSignal,
//   request: SelectedItemsPageRequest,
// ): Promise<SelectedItemsPage> {
//   const query = new URLSearchParams();

//   if (request.search !== undefined) {
//     query.set("search", request.search);
//   }

//   if (request.after !== undefined) {
//     query.set("after", request.after);
//   }

//   if (request.before !== undefined) {
//     query.set("before", request.before);
//   }

//   const queryString = query.toString();

//   const url = `${getApiUrl()}/api/items/selected${
//     queryString.length > 0 ? `?${queryString}` : ""
//   }`;

//   let response: Response;

//   try {
//     response = await fetch(url, {
//       signal,
//       headers: { Accept: "application/json" },
//     });
//   } catch (error) {
//     if (signal.aborted) {
//       throw error;
//     }

//     throw new ApiRequestError(
//       "NETWORK_ERROR",
//       "Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.",
//     );
//   }

//   if (!response.ok) {
//     throw await readApiErrorResponse(
//       response,
//       "Не удалось загрузить выбранные элементы. Попробуйте снова.",
//     );
//   }

//   const data = await parseJson(response);

//   if (!isSelectedItemsPage(data)) {
//     throw new ApiRequestError(
//       "INVALID_RESPONSE",
//       "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
//     );
//   }

//   const hasRequestedContinuation =
//     request.before !== undefined
//       ? data.pageInfo.hasPreviousPage
//       : data.pageInfo.hasNextPage;

//   if (hasRequestedContinuation && data.ids.length !== PAGE_SIZE) {
//     throw new ApiRequestError(
//       "INVALID_PAGE_SIZE",
//       "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
//     );
//   }

//   return data;
// }

// async function mutateSelection(
//   id: number,
//   selected: boolean,
// ): Promise<SelectionMutationResponse> {
//   let response: Response;

//   try {
//     response = await fetch(`${getApiUrl()}/api/items/${id}/selection`, {
//       method: selected ? "POST" : "DELETE",
//       headers: { Accept: "application/json" },
//     });
//   } catch {
//     throw new ApiRequestError(
//       "NETWORK_ERROR",
//       "Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.",
//     );
//   }

//   if (!response.ok) {
//     throw await readApiErrorResponse(
//       response,
//       "Не удалось изменить выбор. Попробуйте снова.",
//     );
//   }

//   const data = await parseJson(response);

//   if (
//     !isSelectionMutationResponse(data) ||
//     data.id !== id ||
//     data.selected !== selected
//   ) {
//     throw new ApiRequestError(
//       "INVALID_RESPONSE",
//       "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
//     );
//   }

//   return data;
// }

// export async function selectItem(
//   id: number,
// ): Promise<SelectionMutationResponse> {
//   return mutateSelection(id, true);
// }

// export async function unselectItem(
//   id: number,
// ): Promise<SelectionMutationResponse> {
//   return mutateSelection(id, false);
// }
