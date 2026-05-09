import { Router } from "express";
import { createExcelFile, getExcelFile } from "../handlers/excelHandlers";

const router = Router();

router.post("/create", createExcelFile);
router.get("/:id", getExcelFile);

export default router;
