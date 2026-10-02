import { Router } from "express";

import {
  addItems,
  getAvailableItems,
  getSelectedItems,
  selectItem,
  unselectItem,
} from "../controllers/items.controller.js";

export const itemsRouter = Router();

itemsRouter.get("/available", getAvailableItems);
itemsRouter.post("/", addItems);

itemsRouter.get("/selected", getSelectedItems);
itemsRouter.post("/:id/selection", selectItem);
itemsRouter.delete("/:id/selection", unselectItem);
