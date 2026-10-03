import { Router } from "express";

import {
  addItems,
  getAvailableItems,
  getSelectedItems,
  updateSelectionBatch,
} from "../controllers/items.controller.js";

export const itemsRouter = Router();

itemsRouter.get("/available", getAvailableItems);
itemsRouter.post("/", addItems);

itemsRouter.get("/selected", getSelectedItems);
itemsRouter.post("/selection-batch", updateSelectionBatch);
