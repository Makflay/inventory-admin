import type { SelectedItems } from "@inventory/shared";

import { ApiRequestError, readApiErrorResponse } from "./api-error";

function isSelectedItems(value: unknown): value is SelectedItems {
  if (
    typeof value !== "object" ||
    value === null ||
    !("ids" in value) ||
    !Array.isArray(value.ids)
  ) {
    return false;
  }

  const ids: unknown[] = value.ids;
  const uniqueIds = new Set<number>();

  for (const id of ids) {
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      uniqueIds.has(id)
    ) {
      return false;
    }

    uniqueIds.add(id);
  }

  return true;
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

async function readSelectedItemsResponse(
  response: Response,
): Promise<SelectedItems> {
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

  if (!isSelectedItems(data)) {
    throw new ApiRequestError(
      "INVALID_RESPONSE",
      "Сервер вернул некорректные данные. Обновите страницу и попробуйте снова.",
    );
  }

  return data;
}

export async function getSelectedItems(
  signal: AbortSignal,
): Promise<SelectedItems> {
  let response: Response;

  try {
    response = await fetch(`${getApiUrl()}/api/items/selected`, {
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

  return readSelectedItemsResponse(response);
}

export async function selectItem(id: number): Promise<SelectedItems> {
  let response: Response;

  try {
    response = await fetch(`${getApiUrl()}/api/items/${id}/selection`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiRequestError(
      "NETWORK_ERROR",
      "Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.",
    );
  }

  return readSelectedItemsResponse(response);
}

export async function unselectItem(id: number): Promise<SelectedItems> {
  let response: Response;

  try {
    response = await fetch(`${getApiUrl()}/api/items/${id}/selection`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiRequestError(
      "NETWORK_ERROR",
      "Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.",
    );
  }

  return readSelectedItemsResponse(response);
}
