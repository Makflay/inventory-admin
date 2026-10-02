export type ApiError = {
  error: string;
  message: string;
};

export class ApiRequestError extends Error {
  readonly error: string;

  constructor(error: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.error = error;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string" &&
    value.error.trim().length > 0 &&
    "message" in value &&
    typeof value.message === "string" &&
    value.message.trim().length > 0
  );
}

export async function readApiErrorResponse(
  response: Response,
  fallbackMessage: string,
): Promise<ApiRequestError> {
  let data: unknown;

  try {
    data = await response.json();
  } catch {
    return new ApiRequestError("INVALID_ERROR_RESPONSE", fallbackMessage);
  }

  if (!isApiError(data)) {
    return new ApiRequestError("INVALID_ERROR_RESPONSE", fallbackMessage);
  }

  return new ApiRequestError(data.error, data.message);
}
