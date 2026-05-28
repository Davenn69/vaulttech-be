import { Router } from "express";
import {
  createWordFile,
  getWordCollaboration,
  getWordFile,
  joinWordCollaboration,
  save,
  syncWordCollaboration,
} from "../handlers/wordHandlers";

const router = Router();

router.post("/create", createWordFile);
router.patch("/save", save);
router.get("/:id/collaboration", getWordCollaboration);
router.post("/:id/collaboration/join", joinWordCollaboration);
router.patch("/:id/collaboration/sync", syncWordCollaboration);
router.get("/:id", getWordFile);

export default router;
