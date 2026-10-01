import { Router } from "express";

import {
  addItems,
  getAvailableItems,
} from "../controllers/items.controller.js";

export const itemsRouter = Router();

itemsRouter.get("/available", getAvailableItems);
itemsRouter.post("/", addItems);
