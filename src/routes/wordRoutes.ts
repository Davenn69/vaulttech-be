import { Router } from "express";
import { createWordFile } from "../handlers/wordHandlers";

const router = Router();

router.post("/create", createWordFile);

export default router;
