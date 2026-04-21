import { Router } from "express";
import { createWordFile, getWordFile } from "../handlers/wordHandlers";

const router = Router();

router.post("/create", createWordFile);
router.get("/:id", getWordFile);

export default router;
