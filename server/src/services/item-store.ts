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

function matchesSearch(id: number, search: string): boolean {
  return search === "" || String(id).includes(search);
}

export type SelectItemResult = "selected" | "not_found" | "already_selected";

export type UnselectItemResult = "unselected" | "not_selected";

class ItemStore {
  private readonly customIds = new Set<number>();
  private readonly selectedIds = new Set<number>();
  private readonly selectedOrder: number[] = [];

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

  getSelectedItems(): number[] {
    return [...this.selectedOrder];
  }

  selectItem(id: number): SelectItemResult {
    if (!this.exists(id)) {
      return "not_found";
    }

    if (this.selectedIds.has(id)) {
      return "already_selected";
    }

    this.selectedIds.add(id);
    this.selectedIds.delete(id);

    return "selected";
  }

  unselectItem(id: number): UnselectItemResult {
    if (!this.selectedIds.has(id)) {
      return "not_selected";
    }

    this.selectedIds.delete(id);

    const index = this.selectedOrder.indexOf(id);

    if (index >= 0) {
      this.selectedOrder.slice(index, 1);
    }

    return "unselected";
  }

  private collectAfter(
    boundary: number,
    search: string,
    limit: number,
  ): number[] {
    const result: number[] = [];

    if (boundary < BASE_ID_MAX) {
      for (
        let id = Math.max(BASE_ID_MIN, boundary + 1);
        id <= BASE_ID_MAX && result.length < limit;
        id++
      ) {
        if (!this.selectedIds.has(id) && matchesSearch(id, search)) {
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
        this.selectedIds.has(id) ||
        !matchesSearch(id, search)
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

  private collectBefore(
    boundary: number,
    search: string,
    limit: number,
  ): number[] {
    const result: number[] = [];

    for (const id of this.customIds) {
      if (
        !isValidId(id) ||
        id <= BASE_ID_MAX ||
        id >= boundary ||
        this.selectedIds.has(id) ||
        !matchesSearch(id, search)
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
      if (!this.selectedIds.has(id) && matchesSearch(id, search)) {
        result.push(id);
      }
    }

    return result;
  }

  private createPage(
    ids: number[],
    search: string,
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
        hasNextPage: this.collectAfter(endId, search, 1).length > 0,
        hasPreviousPage: this.collectBefore(startId, search, 1).length > 0,
      },
    };
  }

  getAvailablePage(
    request: AvailableItemsPageRequest = {},
  ): AvailableItemsPage {
    const search = request.search ?? "";

    if (request.after !== undefined) {
      const boundary = Number(request.after);
      const ids = this.collectAfter(boundary, search, PAGE_SIZE);

      return this.createPage(
        ids,
        search,
        false,
        this.collectBefore(boundary, search, 1).length > 0,
      );
    }

    if (request.before !== undefined) {
      const boundary = Number(request.before);
      const ids = this.collectBefore(boundary, search, PAGE_SIZE).reverse();

      return this.createPage(
        ids,
        search,
        this.collectAfter(boundary, search, 1).length > 0,
        false,
      );
    }

    const ids = this.collectAfter(0, search, PAGE_SIZE);

    return this.createPage(ids, search, false, false);
  }
}

export const itemStore = new ItemStore();
