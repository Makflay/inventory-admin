import type {
  AvailableItemsPage,
  AvailableItemsPageRequest,
} from "@inventory/shared";

const BASE_ID_MIN = 1;
const BASE_ID_MAX = 1_000_000;
const PAGE_SIZE = 20;

function isValidId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

class ItemStore {
  private readonly customIds = new Set<number>();
  private readonly selectedIds = new Set<number>();

  exists(id: number): boolean {
    if (!isValidId(id)) {
      return false;
    }

    return (id >= BASE_ID_MIN && id <= BASE_ID_MAX) || this.customIds.has(id);
  }

  addMany(ids: Iterable<number>): void {
    for (const id of ids) {
      this.customIds.add(id);
    }
  }

  setSelected(id: number, selected: boolean): void {
    if (!this.exists(id)) {
      throw new RangeError("Указанный элемент не существует");
    }

    if (selected) {
      this.selectedIds.add(id);
    } else {
      this.selectedIds.delete(id);
    }
  }

  private collectAfter(boundary: number, limit: number): number[] {
    const result: number[] = [];

    if (boundary < BASE_ID_MAX) {
      for (
        let id = Math.max(BASE_ID_MIN, boundary + 1);
        id <= BASE_ID_MAX && result.length < limit;
        id++
      ) {
        if (!this.selectedIds.has(id)) {
          result.push(id);
        }
      }
    }

    if (result.length >= limit) {
      return result;
    }

    for (const id of this.customIds) {
      if (
        !isValidId(id) ||
        id <= BASE_ID_MAX ||
        id <= boundary ||
        this.selectedIds.has(id)
      ) {
        continue;
      }

      result.push(id);
      result.sort((left, right) => left - right);

      if (result.length > limit) {
        result.pop();
      }
    }

    return result;
  }

  private collectBefore(boundary: number, limit: number): number[] {
    const result: number[] = [];

    for (const id of this.customIds) {
      if (
        !isValidId(id) ||
        id <= BASE_ID_MAX ||
        id >= boundary ||
        this.selectedIds.has(id)
      ) {
        continue;
      }

      result.push(id);
      result.sort((left, right) => right - left);

      if (result.length > limit) {
        result.pop();
      }
    }

    if (result.length >= limit) {
      return result;
    }

    for (
      let id = Math.min(BASE_ID_MAX, boundary - 1);
      id >= BASE_ID_MIN && result.length < limit;
      id--
    ) {
      if (!this.selectedIds.has(id)) {
        result.push(id);
      }
    }

    return result;
  }

  private createPage(
    ids: number[],
    emptyHasNextPage: boolean,
    emptyHasPreviousPage: boolean,
  ): AvailableItemsPage {
    if (ids.length === 0) {
      return {
        ids: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: emptyHasNextPage,
          hasPreviousPage: emptyHasPreviousPage,
        },
      };
    }

    const startId = ids[0]!;
    const endId = ids[ids.length - 1]!;

    return {
      ids,
      pageInfo: {
        startCursor: String(startId),
        endCursor: String(endId),
        hasNextPage: this.collectAfter(endId, 1).length > 0,
        hasPreviousPage: this.collectBefore(startId, 1).length > 0,
      },
    };
  }

  getAvailablePage(
    request: AvailableItemsPageRequest = {},
  ): AvailableItemsPage {
    if (request.after !== undefined) {
      const boundary = Number(request.after);
      const ids = this.collectAfter(boundary, PAGE_SIZE);

      return this.createPage(
        ids,
        false,
        this.collectBefore(boundary, 1).length > 0,
      );
    }

    if (request.before !== undefined) {
      const boundary = Number(request.before);
      const ids = this.collectBefore(boundary, PAGE_SIZE).reverse();

      return this.createPage(
        ids,
        this.collectAfter(boundary, 1).length > 0,
        false,
      );
    }

    const ids = this.collectAfter(0, PAGE_SIZE);

    return this.createPage(ids, false, false);
  }
}

export const itemStore = new ItemStore();
