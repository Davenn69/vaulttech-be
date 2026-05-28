import { Router } from "express";
import {
  approveDocument,
  declineDocument,
  getReviewCommentsByFile,
  getReviewableFiles,
} from "../handlers/reviewHandlers";

const router = Router();

router.get("/files", getReviewableFiles);
router.get("/files/:id/comments", getReviewCommentsByFile);
router.patch("/approve", approveDocument);
router.patch("/decline", declineDocument);

export default router;
