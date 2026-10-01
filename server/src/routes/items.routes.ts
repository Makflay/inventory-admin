import { Router } from "express";

import { addItems } from "../controllers/items.controller.js";

export const itemsRouter = Router();

itemsRouter.post("/", addItems);
