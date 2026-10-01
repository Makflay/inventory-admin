export type ApiError = {
  error: string;
  message: string;
};

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}
