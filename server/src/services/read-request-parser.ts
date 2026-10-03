import type { AvailableItemsPageRequest } from "@inventory/shared";

const CURSOR_PATTERN = /^[1-9]\d{0,15}$/;
const SEARCH_PATTERN = /^[1-9]\d*$/;

const ALLOWED_KEYS = new Set(["search", "after", "before"]);

export type ReadRequestParseError = {
  error: string;
  message: string;
};

export type ReadRequestParseResult =
  | {
      success: true;
      request: AvailableItemsPageRequest;
    }
  | {
      success: false;
      failure: ReadRequestParseError;
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(error: string, message: string): ReadRequestParseResult {
  return {
    success: false,
    failure: {
      error,
      message,
    },
  };
}

function parseSearch(value: unknown):
  | { success: true; search: string }
  | {
      success: false;
      failure: ReadRequestParseError;
    } {
  if (value === undefined || value === "") {
    return {
      success: true,
      search: "",
    };
  }

  if (typeof value !== "string" || !SEARCH_PATTERN.test(value)) {
    return {
      success: false,
      failure: {
        error: "INVALID_SEARCH",
        message:
          "Введите последовательность цифр без ведущих нулей или очистите поле поиска.",
      },
    };
  }

  return {
    success: true,
    search: value,
  };
}

function parseCursor(value: unknown):
  | { success: true; cursor: string }
  | {
      success: false;
      failure: ReadRequestParseError;
    } {
  if (typeof value !== "string" || !CURSOR_PATTERN.test(value)) {
    return {
      success: false,
      failure: {
        error: "INVALID_CURSOR",
        message:
          "Не удалось определить позицию в списке. Обновите страницу и попробуйте снова.",
      },
    };
  }

  const cursor = Number(value);

  if (!Number.isSafeInteger(cursor)) {
    return {
      success: false,
      failure: {
        error: "INVALID_CURSOR",
        message:
          "Не удалось определить позицию в списке. Обновите страницу и попробуйте снова.",
      },
    };
  }

  return {
    success: true,
    cursor: value,
  };
}

export function parseReadPageRequest(value: unknown): ReadRequestParseResult {
  if (!isObject(value)) {
    return failure(
      "INVALID_READ_REQUEST",
      "Не удалось обработать запрос списка. Попробуйте снова.",
    );
  }

  if (Object.keys(value).some((key) => !ALLOWED_KEYS.has(key))) {
    return failure(
      "INVALID_READ_REQUEST",
      "Не удалось обработать запрос списка. Попробуйте снова.",
    );
  }

  const searchResult = parseSearch(value.search);

  if (!searchResult.success) {
    return {
      success: false,
      failure: searchResult.failure,
    };
  }

  const rawAfter = value.after;
  const rawBefore = value.before;

  if (rawAfter !== undefined && rawBefore !== undefined) {
    return failure(
      "INVALID_PAGINATION",
      "Не удалось определить нужную часть списка. Обновите страницу и попробуйте снова.",
    );
  }

  if (rawAfter !== undefined) {
    const afterResult = parseCursor(rawAfter);

    if (!afterResult.success) {
      return {
        success: false,
        failure: afterResult.failure,
      };
    }

    return {
      success: true,
      request: {
        search: searchResult.search,
        after: afterResult.cursor,
      },
    };
  }

  if (rawBefore !== undefined) {
    const beforeResult = parseCursor(rawBefore);

    if (!beforeResult.success) {
      return {
        success: false,
        failure: beforeResult.failure,
      };
    }

    return {
      success: true,
      request: {
        search: searchResult.search,
        before: beforeResult.cursor,
      },
    };
  }

  return {
    success: true,
    request: {
      search: searchResult.search,
    },
  };
}
