import "dotenv/config";

import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT должен быть целым числом от 1 до 65535");
}

app.listen(port, () => {
  console.log(`Server start on: http://localhost:${port}`);
});
