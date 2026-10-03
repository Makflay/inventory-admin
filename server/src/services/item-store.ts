import type {
  AvailableItemsPage,
  AvailableItemsPageRequest,
  SelectedItemsPage,
  SelectedItemsPageRequest,
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

  selectItem(id: number): SelectItemResult {
    if (!this.exists(id)) {
      return "not_found";
    }

    if (this.selectedIds.has(id)) {
      return "already_selected";
    }

    this.selectedIds.add(id);
    this.selectedOrder.push(id);

    return "selected";
  }

  unselectItem(id: number): UnselectItemResult {
    if (!this.selectedIds.has(id)) {
      return "not_selected";
    }

    this.selectedIds.delete(id);

    const index = this.selectedOrder.indexOf(id);

    if (index >= 0) {
      this.selectedOrder.splice(index, 1);
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

  private matchesSelectedSearch(id: number, search: string): boolean {
    return this.selectedIds.has(id) && matchesSearch(id, search);
  }

  private hasMatchingSelectedBefore(
    boundaryIndex: number,
    search: string,
  ): boolean {
    for (let index = boundaryIndex - 1; index >= 0; index--) {
      const id = this.selectedOrder[index]!;

      if (this.matchesSelectedSearch(id, search)) {
        return true;
      }
    }

    return false;
  }

  private hasMatchingSelectedAfter(
    boundaryIndex: number,
    search: string,
  ): boolean {
    for (
      let index = boundaryIndex + 1;
      index < this.selectedOrder.length;
      index++
    ) {
      const id = this.selectedOrder[index]!;

      if (this.matchesSelectedSearch(id, search)) {
        return true;
      }
    }

    return false;
  }

  private collectSelectedAfter(
    boundaryIndex: number,
    search: string,
    limit: number,
  ): {
    ids: number[];
    startIndex: number | null;
    endIndex: number | null;
  } {
    const ids: number[] = [];
    let startIndex: number | null = null;
    let endIndex: number | null = null;

    for (
      let index = boundaryIndex + 1;
      index < this.selectedOrder.length && ids.length < limit;
      index++
    ) {
      const id = this.selectedOrder[index]!;

      if (!this.matchesSelectedSearch(id, search)) {
        continue;
      }

      startIndex ??= index;
      endIndex = index;
      ids.push(id);
    }

    return {
      ids,
      startIndex,
      endIndex,
    };
  }

  private collectSelectedBefore(
    boundaryIndex: number,
    search: string,
    limit: number,
  ): {
    ids: number[];
    startIndex: number | null;
    endIndex: number | null;
  } {
    const matches: Array<{ id: number; index: number }> = [];

    for (
      let index = boundaryIndex - 1;
      index >= 0 && matches.length < limit;
      index--
    ) {
      const id = this.selectedOrder[index]!;

      if (this.matchesSelectedSearch(id, search)) {
        matches.push({ id, index });
      }
    }

    matches.reverse();

    return {
      ids: matches.map((match) => match.id),
      startIndex: matches[0]?.index ?? null,
      endIndex: matches[matches.length - 1]?.index ?? null,
    };
  }

  private createSelectedPage(
    ids: number[],
    startIndex: number | null,
    endIndex: number | null,
    search: string,
    emptyHasNextPage: boolean,
    emptyHasPreviousPage: boolean,
  ): SelectedItemsPage {
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

    if (startIndex === null || endIndex === null) {
      throw new Error("Selected page indices are missing");
    }

    return {
      ids,
      pageInfo: {
        startCursor: String(ids[0]),
        endCursor: String(ids[ids.length - 1]),
        hasNextPage: this.hasMatchingSelectedAfter(endIndex, search),
        hasPreviousPage: this.hasMatchingSelectedBefore(startIndex, search),
      },
    };
  }

  getSelectedPage(
    request: SelectedItemsPageRequest = {},
  ): SelectedItemsPage | null {
    const search = request.search ?? "";

    if (request.after !== undefined) {
      const boundaryId = Number(request.after);
      const boundaryIndex = this.selectedOrder.indexOf(boundaryId);

      if (
        boundaryIndex < 0 ||
        !this.matchesSelectedSearch(boundaryId, search)
      ) {
        return null;
      }

      const page = this.collectSelectedAfter(boundaryIndex, search, PAGE_SIZE);

      return this.createSelectedPage(
        page.ids,
        page.startIndex,
        page.endIndex,
        search,
        this.hasMatchingSelectedAfter(boundaryIndex, search),
        true,
      );
    }

    if (request.before !== undefined) {
      const boundaryId = Number(request.before);
      const boundaryIndex = this.selectedOrder.indexOf(boundaryId);

      if (
        boundaryIndex < 0 ||
        !this.matchesSelectedSearch(boundaryId, search)
      ) {
        return null;
      }

      const page = this.collectSelectedBefore(boundaryIndex, search, PAGE_SIZE);

      return this.createSelectedPage(
        page.ids,
        page.startIndex,
        page.endIndex,
        search,
        true,
        this.hasMatchingSelectedBefore(boundaryIndex, search),
      );
    }

    const page = this.collectSelectedAfter(-1, search, PAGE_SIZE);

    return this.createSelectedPage(
      page.ids,
      page.startIndex,
      page.endIndex,
      search,
      false,
      false,
    );
  }

  private isAvailableForSearch(id: number, search: string): boolean {
    return (
      this.exists(id) && !this.selectedIds.has(id) && matchesSearch(id, search)
    );
  }

  private hasAvailableAtOrBefore(boundary: number, search: string): boolean {
    return (
      this.isAvailableForSearch(boundary, search) ||
      this.collectBefore(boundary, search, 1).length > 0
    );
  }

  private hasAvailableAtOrAfter(boundary: number, search: string): boolean {
    return (
      this.isAvailableForSearch(boundary, search) ||
      this.collectAfter(boundary, search, 1).length > 0
    );
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
        this.hasAvailableAtOrBefore(boundary, search),
      );
    }

    if (request.before !== undefined) {
      const boundary = Number(request.before);
      const ids = this.collectBefore(boundary, search, PAGE_SIZE).reverse();

      return this.createPage(
        ids,
        search,
        this.hasAvailableAtOrAfter(boundary, search),
        false,
      );
    }

    const ids = this.collectAfter(0, search, PAGE_SIZE);

    return this.createPage(ids, search, false, false);
  }
}

export const itemStore = new ItemStore();
