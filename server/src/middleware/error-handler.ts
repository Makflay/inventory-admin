import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 500;

  if (status === 400) {
    res.status(400).json({
      error: "INVALID_REQUEST",
      message:
        "Не удалось обработать отправленные данные. Проверьте их и попробуйте снова.",
    });
    return;
  }

  if (status === 413) {
    res.status(413).json({
      error: "PAYLOAD_TOO_LARGE",
      message:
        "Отправлено слишком много данных. Уменьшите их объём и попробуйте снова.",
    });
    return;
  }

  if (status === 415) {
    res.status(415).json({
      error: "UNSUPPORTED_MEDIA_TYPE",
      message: "Неподдерживаемая кодировка или формат тела запроса",
    });
    return;
  }

  console.error(error);

  res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "На сервере произошла ошибка. Попробуйте снова позже.",
  });
};
