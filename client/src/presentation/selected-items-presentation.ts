import type {
  OptimisticReorderOperation,
  OptimisticSelection,
} from "../types/selection";
import type { CachedSelectedPage } from "../services/selected-items-cache";

import { areSelectedPagesAdjacent } from "../services/selected-items-cache";

export type SelectedPresentationItemRow = {
  kind: "item";
  key: string;
  id: number;
  pageKey: string | null;
  optimistic: boolean;
  regionKey: string | null;
};

export type SelectedPresentationBoundaryRow = {
  kind: "boundary";
  key: string;
  before: string | null;
  after: string | null;
};

export type SelectedPresentationEndRow = {
  kind: "end";
  key: string;
};

export type SelectedVirtualRow =
  | SelectedPresentationItemRow
  | SelectedPresentationBoundaryRow
  | SelectedPresentationEndRow;

type BuildSelectedPresentationInput = {
  pages: readonly CachedSelectedPage[];
  optimisticSelection: OptimisticSelection;
  optimisticReorders: readonly OptimisticReorderOperation[];
  search: string;
  initialized: boolean;
};

export type SelectedPresentation = {
  rows: SelectedVirtualRow[];
  detachedPendingIds: number[];
};

function matchesSearch(id: number, search: string): boolean {
  return search === "" || String(id).includes(search);
}

export function areSelectedRowsInSameRegion(
  left: SelectedPresentationItemRow,
  right: SelectedPresentationItemRow,
): boolean {
  return left.regionKey !== null && left.regionKey === right.regionKey;
}

function applyOptimisticReorders(
  rows: readonly SelectedVirtualRow[],
  operations: readonly OptimisticReorderOperation[],
  search: string,
): SelectedVirtualRow[] {
  const result = [...rows];

  for (const operation of operations) {
    if (operation.search !== search) {
      continue;
    }

    const draggedIndex = result.findIndex(
      (row) => row.kind === "item" && row.id === operation.draggedId,
    );

    const targetIndex = result.findIndex(
      (row) => row.kind === "item" && row.id === operation.targetId,
    );

    if (draggedIndex < 0 || targetIndex < 0) {
      continue;
    }

    const dragged = result[draggedIndex];
    const target = result[targetIndex];

    if (
      dragged?.kind !== "item" ||
      target?.kind !== "item" ||
      !areSelectedRowsInSameRegion(dragged, target)
    ) {
      continue;
    }

    result.splice(draggedIndex, 1);

    const currentTargetIndex = result.findIndex(
      (row) => row.kind === "item" && row.id === operation.targetId,
    );

    const insertionIndex =
      operation.placement === "before"
        ? currentTargetIndex
        : currentTargetIndex + 1;

    result.splice(insertionIndex, 0, dragged);
  }

  return result;
}

export function buildSelectedPresentation({
  pages,
  optimisticSelection,
  optimisticReorders,
  search,
  initialized,
}: BuildSelectedPresentationInput): SelectedPresentation {
  const rows: SelectedVirtualRow[] = [];
  const detachedPendingIds: number[] = [];

  let regionNumber = -1;
  let regionKey: string | null = null;

  for (const [pageIndex, page] of pages.entries()) {
    const previous = pages[pageIndex - 1];

    const hasGap =
      previous !== undefined && !areSelectedPagesAdjacent(previous, page);

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

      regionNumber++;
      regionKey = `region:${regionNumber}`;
    }

    for (const id of page.data.ids) {
      const operation = optimisticSelection.get(id);

      if (operation?.action === "unselect") {
        continue;
      }

      rows.push({
        kind: "item",
        key: `item:${id}`,
        id,
        pageKey: page.key,
        optimistic: operation?.action === "select",
        regionKey,
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
    if (operation.action !== "select" || !matchesSearch(id, search)) {
      continue;
    }

    const alreadyConfirmed = rows.some(
      (row) => row.kind === "item" && row.id === id,
    );

    if (alreadyConfirmed) {
      continue;
    }

    const endIndex = rows.findIndex((row) => row.kind === "end");

    const confirmedFilteredListIsEmpty =
      initialized && pages.length === 0 && rows.length === 0;

    const lastItemRegion =
      [...rows]
        .reverse()
        .find((row): row is SelectedPresentationItemRow => row.kind === "item")
        ?.regionKey ?? null;

    if (endIndex >= 0) {
      rows.splice(endIndex, 0, {
        kind: "item",
        key: `optimistic-item:${id}`,
        id,
        pageKey: null,
        optimistic: true,
        regionKey: lastItemRegion,
      });

      continue;
    }

    if (confirmedFilteredListIsEmpty) {
      rows.push({
        kind: "item",
        key: `optimistic-item:${id}`,
        id,
        pageKey: null,
        optimistic: true,
        regionKey: "region:optimistic-empty",
      });

      continue;
    }

    detachedPendingIds.push(id);
  }

  return {
    rows: applyOptimisticReorders(rows, optimisticReorders, search),
    detachedPendingIds,
  };
}
