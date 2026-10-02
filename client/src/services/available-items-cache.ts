import type {
  AvailableItemsPage,
  AvailableItemsPageRequest,
} from "@inventory/shared";

const MAX_PAGES = 250;
const PAGE_SIZE = 20;

export type CachedPage = {
  key: string;
  data: AvailableItemsPage;

  requestAfter: string | null;
  requestBefore: string | null;
};

function startCursor(page: CachedPage): string {
  return page.data.pageInfo.startCursor!;
}

function endCursor(page: CachedPage): string {
  return page.data.pageInfo.endCursor!;
}

export function areAdjacent(left: CachedPage, right: CachedPage): boolean {
  return (
    right.requestAfter === endCursor(left) ||
    left.requestBefore === startCursor(right)
  );
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

  anchor(request: AvailableItemsPageRequest): CachedPage | undefined {
    if (request.after !== undefined) {
      return [...this.entries.values()].find(
        (page) => endCursor(page) === request.after,
      );
    }

    if (request.before !== undefined) {
      return [...this.entries.values()].find(
        (page) => startCursor(page) === request.before,
      );
    }

    return undefined;
  }

  read(request: AvailableItemsPageRequest): CachedPage | undefined {
    const pages = this.snapshot();
    let result: CachedPage | undefined;

    if (request.after === undefined && request.before === undefined) {
      result = pages.find((page) => !page.data.pageInfo.hasPreviousPage);
    } else if (request.after !== undefined) {
      result = pages.find((page) => page.requestAfter === request.after);

      if (result === undefined) {
        const anchor = this.anchor(request);
        const anchorIndex = pages.findIndex((page) => page.key === anchor?.key);

        const neighbor = anchorIndex >= 0 ? pages[anchorIndex + 1] : undefined;

        if (
          anchor !== undefined &&
          neighbor !== undefined &&
          areAdjacent(anchor, neighbor)
        ) {
          result = neighbor;
        }
      }
    } else if (request.before !== undefined) {
      result = pages.find((page) => page.requestBefore === request.before);

      if (result === undefined) {
        const anchor = this.anchor(request);
        const anchorIndex = pages.findIndex((page) => page.key === anchor?.key);
        const neighbor = anchorIndex >= 0 ? pages[anchorIndex - 1] : undefined;

        if (
          anchor !== undefined &&
          neighbor !== undefined &&
          areAdjacent(neighbor, anchor)
        ) {
          result = neighbor;
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
    request: AvailableItemsPageRequest,
    visibleKeys: ReadonlySet<string>,
  ): void {
    const anchor = this.anchor(request);

    if (data.ids.length === 0) {
      if (anchor === undefined) {
        return;
      }

      if (request.after !== undefined) {
        this.entries.set(anchor.key, {
          ...anchor,
          data: {
            ...anchor.data,
            pageInfo: {
              ...anchor.data.pageInfo,
              hasNextPage: false,
            },
          },
        });
      } else if (request.before !== undefined) {
        this.entries.set(anchor.key, {
          ...anchor,
          data: {
            ...anchor.data,
            pageInfo: {
              ...anchor.data.pageInfo,
              hasPreviousPage: false,
            },
          },
        });
      }

      this.touch(anchor.key);
      return;
    }

    if (data.ids.length > PAGE_SIZE) {
      throw new Error("Страница превышает 20 элементов");
    }

    const key = data.pageInfo.startCursor!;
    const last = data.ids[data.ids.length - 1]!;
    const existing = this.entries.get(key);

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

      if (
        Number(startCursor(page)) <= last &&
        Number(endCursor(page)) >= Number(key)
      ) {
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
      requestAfter:
        request.after !== undefined
          ? request.after
          : (existing?.requestAfter ?? null),
      requestBefore:
        request.before !== undefined
          ? request.before
          : (existing?.requestBefore ?? null),
    };

    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
