const BASE_ID_MIN = 1;
const BASE_ID_MAX = 1_000_000;

class ItemStore {
  private readonly customIds = new Set<number>();

  exists(id: number): boolean {
    return (id >= BASE_ID_MIN && id <= BASE_ID_MAX) || this.customIds.has(id);
  }

  addMany(ids: Iterable<number>): void {
    for (const id of ids) {
      this.customIds.add(id);
    }
  }
}

export const itemStore = new ItemStore();
