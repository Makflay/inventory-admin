import { isApiError } from "./api-error";

export type AvailableItemsPage = {
  ids: number[];
  nextCursor: string | null;
  hasMore: boolean;
};

function isAvailableItemsPage(value: unknown): value is AvailableItemsPage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("ids" in value) ||
    !Array.isArray(value.ids) ||
    !("nextCursor" in value) ||
    !("hasMore" in value) ||
    typeof value.hasMore !== "boolean"
  ) {
    return false;
  }

  const ids: unknown[] = value.ids;

  const validIds =
    ids.length <= 20 &&
    ids.every(
      (id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0,
    );

  const validCursor =
    value.nextCursor === null ||
    (typeof value.nextCursor === "string" &&
      /^[1-9]\d{0,15}$/.test(value.nextCursor) &&
      Number.isSafeInteger(Number(value.nextCursor)));

  return validIds && validCursor;
}

export async function getAvailableItems(
  signal: AbortSignal,
  cursor: string | null = null,
): Promise<AvailableItemsPage> {
  const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");

  if (!apiUrl) {
    throw new Error("Не настроен адрес API: VITE_API_URL");
  }

  const query = new URLSearchParams();

  if (cursor !== null) {
    query.set("cursor", cursor);
  }

  const queryString = query.toString();
  const url =
    `${apiUrl}/api/items/available` + (queryString ? `?${queryString}` : "");

  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    let errorData: unknown;

    try {
      errorData = await response.json();
    } catch {
      throw new Error(
        `Не удалось загрузить доступные элементы. HTTP ${response.status}`,
      );
    }

    if (isApiError(errorData)) {
      throw new Error(errorData.message);
    }

    throw new Error(
      `Не удалось загрузить доступные элементы. HTTP ${response.status}`,
    );
  }

  const data: unknown = await response.json();

  if (!isAvailableItemsPage(data)) {
    throw new Error("Сервер вернул некорректный список элементов");
  }

  let previousId = cursor === null ? 0 : Number(cursor);

  for (const id of data.ids) {
    if (id <= previousId) {
      throw new Error("Сервер вернул повторяющиеся или неупорядоченные ID");
    }

    previousId = id;
  }

  if (
    data.hasMore &&
    (data.ids.length !== 20 || data.nextCursor !== String(previousId))
  ) {
    throw new Error("Сервер вернул некорректную точку продолжения загрузки");
  }

  if (!data.hasMore && data.nextCursor !== null) {
    throw new Error("Сервер указал продолжение для уже завершённого списка");
  }

  return data;
}
