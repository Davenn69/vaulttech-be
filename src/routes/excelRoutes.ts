import { Router } from "express";
import {
  createExcelFile,
  getExcelFile,
  saveExcelFile,
} from "../handlers/excelHandlers";

const router = Router();

router.post("/create", createExcelFile);
router.post("/save", saveExcelFile);
router.get("/:id", getExcelFile);

export default router;
