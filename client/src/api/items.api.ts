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
): Promise<AvailableItemsPage> {
  const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");

  if (!apiUrl) {
    throw new Error("Не настроен адрес API: VITE_API_URL");
  }

  const response = await fetch(`${apiUrl}/api/items/available`, {
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Не удалось загрузить доступные элементы. HTTP ${response.status}`,
    );
  }

  const data: unknown = await response.json();

  if (!isAvailableItemsPage(data)) {
    throw new Error("Сервер вернул некорректный список элементов");
  }

  return data;
}
