import { Router } from "express";
import {
  getReviewableFileContent,
  getReviewableFiles,
} from "../handlers/reviewHandlers";

const router = Router();

router.get("/files", getReviewableFiles);
router.get("/files/:id", getReviewableFileContent);

export default router;
