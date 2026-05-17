import { Router } from "express";
import {
  createCategory,
  deleteCategory,
  getCategories,
  getFilesByCategory,
  updateCategory,
} from "../handlers/categoryHandlers";

const route = Router();

route.get("/", getCategories);
route.get("/grouped", getFilesByCategory);
route.post("/", createCategory);
route.patch("/", updateCategory);
route.delete("/:id", deleteCategory);

export default route;
