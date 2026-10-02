import type { AvailableItemsPage, PageRequest } from "../api/items.api";

const MAX_PAGES = 250;

export type CachedPage = {
  key: string;
  data: AvailableItemsPage;

  // Известные границы соседства.
  // Они удаляются вместе со страницей.
  before: string | null;
  after: string | null;
};

function lastId(page: CachedPage): string {
  return String(page.data.ids[page.data.ids.length - 1]!);
}

export function areAdjacent(left: CachedPage, right: CachedPage): boolean {
  return right.before === lastId(left) || left.after === right.key;
}

export class AvailableItemsCache {
  private readonly entries = new Map<string, CachedPage>();

  snapshot(): CachedPage[] {
    return [...this.entries.values()].sort(
      (left, right) => Number(left.key) - Number(right.key),
    );
  }

  touch(key: string): void {
    const entry = this.entries.get(key);

    if (entry === undefined) return;

    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  anchor(request: PageRequest): CachedPage | undefined {
    if (request.cursor === null) return undefined;

    return [...this.entries.values()].find((page) =>
      request.direction === "forward"
        ? lastId(page) === request.cursor
        : page.key === request.cursor,
    );
  }

  read(request: PageRequest): CachedPage | undefined {
    const pages = this.snapshot();
    let result: CachedPage | undefined;

    if (request.cursor === null) {
      result = pages.find((page) => !page.data.hasPrevious);
    } else {
      // Страница уже могла быть получена ровно по этому запросу.
      result = pages.find((page) =>
        request.direction === "forward"
          ? page.before === request.cursor
          : page.after === request.cursor,
      );

      if (result === undefined) {
        const anchor = this.anchor(request);
        const index = pages.findIndex((page) => page.key === anchor?.key);

        if (index >= 0) {
          const neighbor =
            request.direction === "forward"
              ? pages[index + 1]
              : pages[index - 1];

          if (
            anchor !== undefined &&
            neighbor !== undefined &&
            (request.direction === "forward"
              ? areAdjacent(anchor, neighbor)
              : areAdjacent(neighbor, anchor))
          ) {
            result = neighbor;
          }
        }
      }
    }

    if (result !== undefined) {
      this.touch(result.key);
    }

    return result;
  }

  insert(
    data: AvailableItemsPage,
    request: PageRequest,
    visibleKeys: ReadonlySet<string>,
  ): void {
    const anchor = this.anchor(request);

    // Пустой ответ завершает загрузку соответствующей границы.
    // Пустые страницы в кэше не накапливаем.
    if (data.ids.length === 0) {
      if (anchor !== undefined) {
        const updated: CachedPage = {
          ...anchor,
          data:
            request.direction === "forward"
              ? {
                  ...anchor.data,
                  hasNext: false,
                  nextCursor: null,
                }
              : {
                  ...anchor.data,
                  hasPrevious: false,
                  prevCursor: null,
                },
        };

        this.entries.set(anchor.key, updated);
        this.touch(anchor.key);
      }

      return;
    }

    if (data.ids.length > 20) {
      throw new Error("Страница превышает 20 элементов");
    }

    const key = String(data.ids[0]!);
    const last = data.ids[data.ids.length - 1]!;
    const existing = this.entries.get(key);

    // При изменении набора данных нельзя молча смешивать
    // пересекающиеся страницы разных состояний сервера.
    for (const page of this.entries.values()) {
      if (page.key === key) {
        if (
          page.data.ids.length !== data.ids.length ||
          page.data.ids.some((id, index) => id !== data.ids[index])
        ) {
          throw new Error("Данные изменились. Обновите страницу.");
        }

        continue;
      }

      if (Number(page.key) <= last && Number(lastId(page)) >= Number(key)) {
        throw new Error("Данные изменились. Обновите страницу.");
      }
    }

    const protectedKeys = new Set(visibleKeys);

    if (anchor !== undefined) {
      protectedKeys.add(anchor.key);
    }

    if (existing === undefined && this.entries.size >= MAX_PAGES) {
      const victim = [...this.entries.keys()].find(
        (entryKey) => !protectedKeys.has(entryKey),
      );

      if (victim === undefined) {
        throw new Error("Нет свободной страницы для вытеснения");
      }

      this.entries.delete(victim);
    }

    const entry: CachedPage = {
      key,
      data,
      before:
        request.direction === "forward"
          ? request.cursor
          : (existing?.before ?? null),
      after:
        request.direction === "backward"
          ? request.cursor
          : (existing?.after ?? null),
    };

    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
