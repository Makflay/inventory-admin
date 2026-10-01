const BASE_ID_MIN = 1;
const BASE_ID_MAX = 1_000_000;
const PAGE_SIZE = 20;

export type AvailableItemsPage = {
  ids: number[];
  nextCursor: string | null;
  hasMore: boolean;
};

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

  getAvailablePage(afterId = 0): AvailableItemsPage {
    if (!Number.isSafeInteger(afterId) || afterId < 0) {
      throw new RangeError(
        "Начальная позиция выборки должна быть целым неотрицательным числом",
      );
    }

    const candidateLimit = PAGE_SIZE + 1;
    const candidates: number[] = [];

    if (afterId < BASE_ID_MAX) {
      for (
        let id = Math.max(BASE_ID_MIN, afterId + 1);
        id <= BASE_ID_MAX && candidates.length < candidateLimit;
        id++
      ) {
        if (!this.selectedIds.has(id)) {
          candidates.push(id);
        }
      }
    }

    if (candidates.length < candidateLimit) {
      for (const id of this.customIds) {
        if (
          !isValidId(id) ||
          id <= BASE_ID_MAX ||
          id <= afterId ||
          this.selectedIds.has(id)
        ) {
          continue;
        }

        if (
          candidates.length === candidateLimit &&
          id >= candidates[candidates.length - 1]!
        ) {
          continue;
        }

        candidates.push(id);
        candidates.sort((left, right) => left - right);

        if (candidates.length > candidateLimit) {
          candidates.pop();
        }
      }
    }

    const hasMore = candidates.length > PAGE_SIZE;
    const ids = candidates.slice(0, PAGE_SIZE);

    return {
      ids,
      nextCursor: hasMore ? String(ids[ids.length - 1]!) : null,
      hasMore,
    };
  }
}

export const itemStore = new ItemStore();
