import { Router } from "express";
import {
  downloadRevision,
  getRevisions,
  revertRevision,
} from "../handlers/revisionHandlers";

const router = Router();

router.get("/:id", getRevisions);
router.get("/:fileId/download/:revisionId", downloadRevision);
router.patch("/:fileId/revert/:revisionId", revertRevision);

export default router;
