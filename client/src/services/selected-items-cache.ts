import type {
  SelectedItemsPage,
  SelectedItemsPageRequest,
} from "@inventory/shared";

const MAX_PAGES = 250;
const PAGE_SIZE = 20;

export type CachedSelectedPage = {
  key: string;
  data: SelectedItemsPage;
  requestAfter: string | null;
  requestBefore: string | null;
};

function startCursor(page: CachedSelectedPage): string {
  return page.data.pageInfo.startCursor!;
}

function endCursor(page: CachedSelectedPage): string {
  return page.data.pageInfo.endCursor!;
}

export function areSelectedPagesAdjacent(
  left: CachedSelectedPage,
  right: CachedSelectedPage,
): boolean {
  return (
    right.requestAfter === endCursor(left) ||
    left.requestBefore === startCursor(right)
  );
}

export class SelectedItemsCache {
  private readonly entries = new Map<string, CachedSelectedPage>();

  private readonly orderedKeys: string[] = [];

  snapshot(): CachedSelectedPage[] {
    return this.orderedKeys
      .map((key) => this.entries.get(key))
      .filter((page): page is CachedSelectedPage => page !== undefined);
  }

  touch(key: string): void {
    const entry = this.entries.get(key);

    if (entry === undefined) {
      return;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  anchor(request: SelectedItemsPageRequest): CachedSelectedPage | undefined {
    const pages = this.snapshot();

    if (request.after !== undefined) {
      return pages.find((page) => endCursor(page) === request.after);
    }

    if (request.before !== undefined) {
      return pages.find((page) => startCursor(page) === request.before);
    }

    return undefined;
  }

  read(request: SelectedItemsPageRequest): CachedSelectedPage | undefined {
    const pages = this.snapshot();
    let result: CachedSelectedPage | undefined;

    if (request.after === undefined && request.before === undefined) {
      result = pages.find((page) => !page.data.pageInfo.hasPreviousPage);
    } else if (request.after !== undefined) {
      result = pages.find((page) => page.requestAfter === request.after);

      if (result === undefined) {
        const anchor = this.anchor(request);
        const index = pages.findIndex((page) => page.key === anchor?.key);
        const neighbor = index >= 0 ? pages[index + 1] : undefined;

        if (
          anchor !== undefined &&
          neighbor !== undefined &&
          areSelectedPagesAdjacent(anchor, neighbor)
        ) {
          result = neighbor;
        }
      }
    } else if (request.before !== undefined) {
      result = pages.find((page) => page.requestBefore === request.before);

      if (result === undefined) {
        const anchor = this.anchor(request);
        const index = pages.findIndex((page) => page.key === anchor?.key);
        const neighbor = index >= 0 ? pages[index - 1] : undefined;

        if (
          anchor !== undefined &&
          neighbor !== undefined &&
          areSelectedPagesAdjacent(neighbor, anchor)
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
    data: SelectedItemsPage,
    request: SelectedItemsPageRequest,
    visibleKeys: ReadonlySet<string>,
  ): void {
    const anchor = this.anchor(request);

    if (data.ids.length === 0) {
      if (anchor === undefined) {
        return;
      }

      const updated: CachedSelectedPage =
        request.after !== undefined
          ? {
              ...anchor,
              data: {
                ...anchor.data,
                pageInfo: {
                  ...anchor.data.pageInfo,
                  hasNextPage: false,
                },
              },
            }
          : {
              ...anchor,
              data: {
                ...anchor.data,
                pageInfo: {
                  ...anchor.data.pageInfo,
                  hasPreviousPage: false,
                },
              },
            };

      this.entries.set(anchor.key, updated);
      this.touch(anchor.key);
      return;
    }

    if (data.ids.length > PAGE_SIZE) {
      throw new Error("Страница превышает 20 элементов");
    }

    const key = data.pageInfo.startCursor!;
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

      if (page.data.ids.some((id) => data.ids.includes(id))) {
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

      const victimIndex = this.orderedKeys.indexOf(victim);

      if (victimIndex >= 0) {
        this.orderedKeys.splice(victimIndex, 1);
      }
    }

    let insertionIndex = this.orderedKeys.length;

    if (anchor !== undefined) {
      const anchorIndex = this.orderedKeys.indexOf(anchor.key);

      insertionIndex =
        request.before !== undefined ? anchorIndex : anchorIndex + 1;
    } else if (request.after === undefined && request.before === undefined) {
      insertionIndex = 0;
    }

    if (existing !== undefined) {
      const existingIndex = this.orderedKeys.indexOf(key);

      if (existingIndex >= 0) {
        this.orderedKeys.splice(existingIndex, 1);

        if (existingIndex < insertionIndex) {
          insertionIndex--;
        }
      }
    }

    const entry: CachedSelectedPage = {
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

    this.orderedKeys.splice(Math.max(0, insertionIndex), 0, key);

    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
