import type {
  SelectionBatchRequest,
  SelectionBatchResponse,
  SelectionBatchResult,
  SelectionMutationOperation,
  StaleServerVersionResponse,
} from "@inventory/shared";

import { ApiRequestError, readApiErrorResponse } from "./api-error";
import { isValidServerVersion } from "../services/server-version";

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
