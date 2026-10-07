import type {
  AddItemBatchResult,
  AddItemsBatchRequest,
  AddItemsBatchResponse,
} from "@inventory/shared";

import { ApiRequestError, readApiErrorResponse } from "./api-error";
import { isValidServerVersion } from "../services/server-version";

export class AdditionBatchRejectedError extends ApiRequestError {
  constructor(error: string, message: string) {
    super(error, message);
    this.name = "AdditionBatchRejectedError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAddItemBatchResult(value: unknown): value is AddItemBatchResult {
  if (
    !isObject(value) ||
    typeof value.id !== "number" ||
    !("status" in value)
  ) {
    return false;
  }

  if (value.status === "added" || value.status === "already_exists") {
    return true;
  }

  return (
    value.status === "rejected" &&
    typeof value.error === "string" &&
    value.error.trim().length > 0 &&
    typeof value.message === "string" &&
    value.message.trim().length > 0
  );
}

function isAddItemsBatchResponse(
  value: unknown,
  request: AddItemsBatchRequest,
): value is AddItemsBatchResponse {
  if (
    !isObject(value) ||
    !Array.isArray(value.results) ||
    value.results.length !== request.ids.length ||
    !isValidServerVersion(value.serverVersion)
  ) {
    return false;
  }

  return value.results.every(
    (result, index) =>
      isAddItemBatchResult(result) && result.id === request.ids[index],
  );
}

export async function addItemsBatch(
  request: AddItemsBatchRequest,
): Promise<AddItemsBatchResponse> {
  const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");

  if (!apiUrl) {
    throw new ApiRequestError(
      "CLIENT_CONFIGURATION_ERROR",
      "Приложение не настроено для подключения к серверу.",
    );
  }

  let response: Response;

  try {
    response = await fetch(`${apiUrl}/api/items`, {
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

  if (!response.ok) {
    const requestError = await readApiErrorResponse(
      response,
      "Не удалось добавить элементы. Попробуйте снова.",
    );

    if (response.status >= 400 && response.status < 500) {
      throw new AdditionBatchRejectedError(
        requestError.error,
        requestError.message,
      );
    }

    throw requestError;
  }

  let data: unknown;

  try {
    data = await response.json();
  } catch {
    throw new ApiRequestError(
      "INVALID_RESPONSE",
      "Сервер вернул некорректные данные. Попробуйте снова.",
    );
  }

  if (!isAddItemsBatchResponse(data, request)) {
    throw new ApiRequestError(
      "INVALID_RESPONSE",
      "Сервер вернул некорректные данные. Попробуйте снова.",
    );
  }

  return data;
}
