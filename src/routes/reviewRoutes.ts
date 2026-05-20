import { Router } from "express";
import {
  approveDocument,
  declineDocument,
  getReviewableFiles,
} from "../handlers/reviewHandlers";

const router = Router();

router.get("/files", getReviewableFiles);
router.patch("/approve", approveDocument);
router.patch("/decline", declineDocument);

export default router;
