import type {
  ReorderSelectedOperation,
  SelectionMutationOperation,
  SetSelectionOperation,
} from "@inventory/shared";

const SEARCH_PATTERN = /^[1-9]\d*$/;

export type ValidatedSelectionBatch = {
  operations: SelectionMutationOperation[];
  baseServerVersion?: number;
};

type SelectionBatchParseFailure = {
  status: 400;
  error: string;
  message: string;
};

export type SelectionBatchParseResult =
  | {
      success: true;
      batch: ValidatedSelectionBatch;
    }
  | {
      success: false;
      failure: SelectionBatchParseFailure;
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isServerVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseSelectionOperation(
  value: unknown,
): SelectionMutationOperation | null {
  if (!isObject(value) || typeof value.kind !== "string") {
    return null;
  }

  if (value.kind === "set_selection") {
    if (!isPositiveId(value.id) || typeof value.selected !== "boolean") {
      return null;
    }

    const operation: SetSelectionOperation = {
      kind: "set_selection",
      id: value.id,
      selected: value.selected,
    };

    return operation;
  }

  if (value.kind === "reorder_selected") {
    if (
      !isPositiveId(value.draggedId) ||
      !isPositiveId(value.targetId) ||
      (value.placement !== "before" && value.placement !== "after") ||
      typeof value.search !== "string" ||
      (value.search !== "" && !SEARCH_PATTERN.test(value.search))
    ) {
      return null;
    }

    const operation: ReorderSelectedOperation = {
      kind: "reorder_selected",
      draggedId: value.draggedId,
      targetId: value.targetId,
      placement: value.placement,
      search: value.search,
    };

    return operation;
  }

  return null;
}

export function parseSelectionBatchRequest(
  body: unknown,
): SelectionBatchParseResult {
  if (
    !isObject(body) ||
    !Array.isArray(body.operations) ||
    body.operations.length === 0
  ) {
    return {
      success: false,
      failure: {
        status: 400,
        error: "INVALID_SELECTION_BATCH",
        message:
          "Не удалось обработать изменения выбранных элементов. Проверьте данные и попробуйте снова.",
      },
    };
  }

  const operations: SelectionMutationOperation[] = [];

  for (const value of body.operations) {
    const operation = parseSelectionOperation(value);

    if (operation === null) {
      return {
        success: false,
        failure: {
          status: 400,
          error: "INVALID_SELECTION_OPERATION",
          message:
            "Не удалось обработать одно из изменений выбора. Проверьте данные и попробуйте снова.",
        },
      };
    }

    operations.push(operation);
  }

  const containsReorder = operations.some(
    (operation) => operation.kind === "reorder_selected",
  );

  if (
    containsReorder &&
    (!("baseServerVersion" in body) || !isServerVersion(body.baseServerVersion))
  ) {
    return {
      success: false,
      failure: {
        status: 400,
        error: "INVALID_BASE_SERVER_VERSION",
        message:
          "Не удалось определить актуальность порядка элементов. Обновите список и попробуйте снова.",
      },
    };
  }

  if (
    !containsReorder &&
    "baseServerVersion" in body &&
    body.baseServerVersion !== undefined
  ) {
    return {
      success: false,
      failure: {
        status: 400,
        error: "UNEXPECTED_BASE_SERVER_VERSION",
        message:
          "Не удалось обработать изменения выбранных элементов. Обновите список и попробуйте снова.",
      },
    };
  }

  if (containsReorder) {
    return {
      success: true,
      batch: {
        operations,
        baseServerVersion: body.baseServerVersion as number,
      },
    };
  }

  return {
    success: true,
    batch: {
      operations,
    },
  };
}
