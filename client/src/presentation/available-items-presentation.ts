import type { OptimisticSelection } from "../types/selection";
import type { PendingAdditions } from "../types/add-items";
import type { CachedPage } from "../services/available-items-cache";

import { areAdjacent } from "../services/available-items-cache";

export type AvailableItemRow = {
  kind: "item";
  key: string;
  id: number;
  pageKey: string | null;
  optimistic: boolean;
  pendingAddition: boolean;
};

export type AvailableBoundaryRow = {
  kind: "boundary";
  key: string;
  before: string | null;
  after: string | null;
};

export type AvailableEndRow = {
  kind: "end";
  key: string;
};

export type AvailableVirtualRow =
  | AvailableItemRow
  | AvailableBoundaryRow
  | AvailableEndRow;

export type DetachedAvailablePendingRow = {
  id: number;
  source: "selection" | "addition";
};

type BuildAvailablePresentationInput = {
  pages: readonly CachedPage[];
  optimisticSelection: OptimisticSelection;
  pendingAdditions: PendingAdditions;
  search: string;
  initialized: boolean;
};

export type AvailablePresentation = {
  rows: AvailableVirtualRow[];
  detachedPendingRows: DetachedAvailablePendingRow[];
};

function matchesSearch(id: number, search: string): boolean {
  return search === "" || String(id).includes(search);
}

function insertPresentationAvailableId(
  rows: AvailableVirtualRow[],
  id: number,
  initialized: boolean,
  source: "selection" | "addition",
): boolean {
  if (rows.some((row) => row.kind === "item" && row.id === id)) {
    return true;
  }

  const createRow = (): AvailableItemRow => ({
    kind: "item",
    key: `${source}-pending-item:${id}`,
    id,
    pageKey: null,
    optimistic: source === "selection",
    pendingAddition: source === "addition",
  });

  const itemPositions = rows.flatMap((row, index) =>
    row.kind === "item" ? [{ index, id: row.id }] : [],
  );

  if (itemPositions.length === 0) {
    if (initialized && rows.length === 0) {
      rows.push(createRow());
      return true;
    }

    return false;
  }

  const nextItemPosition = itemPositions.find((position) => position.id > id);

  if (nextItemPosition !== undefined) {
    const previousItemPosition = [...itemPositions]
      .reverse()
      .find((position) => position.index < nextItemPosition.index);

    if (previousItemPosition === undefined) {
      const hasBoundaryBefore = rows
        .slice(0, nextItemPosition.index)
        .some((row) => row.kind === "boundary");

      if (hasBoundaryBefore) {
        return false;
      }

      rows.splice(nextItemPosition.index, 0, createRow());
      return true;
    }

    const hasBoundaryBetween = rows
      .slice(previousItemPosition.index + 1, nextItemPosition.index)
      .some((row) => row.kind === "boundary");

    if (hasBoundaryBetween || previousItemPosition.id >= id) {
      return false;
    }

    rows.splice(nextItemPosition.index, 0, createRow());
    return true;
  }

  const lastItemPosition = itemPositions[itemPositions.length - 1]!;

  const endIndex = rows.findIndex(
    (row, index) => index > lastItemPosition.index && row.kind === "end",
  );

  const hasBoundaryAfter = rows
    .slice(lastItemPosition.index + 1)
    .some((row) => row.kind === "boundary");

  if (endIndex < 0 || hasBoundaryAfter || lastItemPosition.id >= id) {
    return false;
  }

  rows.splice(endIndex, 0, createRow());
  return true;
}

export function buildAvailablePresentation({
  pages,
  optimisticSelection,
  pendingAdditions,
  search,
  initialized,
}: BuildAvailablePresentationInput): AvailablePresentation {
  const rows: AvailableVirtualRow[] = [];
  const detachedPendingRows: DetachedAvailablePendingRow[] = [];

  for (const [pageIndex, page] of pages.entries()) {
    const previous = pages[pageIndex - 1];
    const hasGap = previous !== undefined && !areAdjacent(previous, page);

    if (pageIndex === 0 || hasGap) {
      const before = page.data.pageInfo.hasPreviousPage
        ? page.data.pageInfo.startCursor
        : null;

      const after =
        hasGap && previous !== undefined && previous.data.pageInfo.hasNextPage
          ? previous.data.pageInfo.endCursor
          : null;

      if (before !== null || after !== null) {
        rows.push({
          kind: "boundary",
          key: `boundary:${previous?.key ?? "start"}:${page.key}`,
          before,
          after,
        });
      }
    }

    for (const id of page.data.ids) {
      const operation = optimisticSelection.get(id);

      if (operation?.action === "select") {
        continue;
      }

      rows.push({
        kind: "item",
        key: `item:${id}`,
        id,
        pageKey: page.key,
        optimistic: operation?.action === "unselect",
        pendingAddition: pendingAdditions.has(id),
      });
    }
  }

  const lastPage = pages[pages.length - 1];

  if (lastPage !== undefined) {
    if (
      lastPage.data.pageInfo.hasNextPage &&
      lastPage.data.pageInfo.endCursor !== null
    ) {
      rows.push({
        kind: "boundary",
        key: `boundary:${lastPage.key}:end`,
        before: null,
        after: lastPage.data.pageInfo.endCursor,
      });
    } else {
      rows.push({
        kind: "end",
        key: "end",
      });
    }
  }

  for (const [id, operation] of optimisticSelection) {
    if (operation.action !== "unselect" || !matchesSearch(id, search)) {
      continue;
    }

    const inserted = insertPresentationAvailableId(
      rows,
      id,
      initialized,
      "selection",
    );

    if (!inserted) {
      detachedPendingRows.push({
        id,
        source: "selection",
      });
    }
  }

  for (const id of pendingAdditions.keys()) {
    if (!matchesSearch(id, search)) {
      continue;
    }

    const alreadyRepresented = rows.some(
      (row) => row.kind === "item" && row.id === id,
    );

    if (alreadyRepresented) {
      continue;
    }

    const inserted = insertPresentationAvailableId(
      rows,
      id,
      initialized,
      "addition",
    );

    if (!inserted) {
      detachedPendingRows.push({
        id,
        source: "addition",
      });
    }
  }

  return {
    rows,
    detachedPendingRows,
  };
}
