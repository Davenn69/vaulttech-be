import { Router } from "express";
import { createWordFile, getWordFile, save } from "../handlers/wordHandlers";

const router = Router();

router.post("/create", createWordFile);
router.patch("/save", save);
router.get("/:id", getWordFile);

export default router;
