import cors from "cors";
import express from "express";

import { errorHandler } from "./middleware/error-handler.js";
import { itemsRouter } from "./routes/items.routes.js";

const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

export const app = express();

app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/items", itemsRouter);

app.use(errorHandler);
