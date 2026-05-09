import { Router } from "express";
import { getRevisions } from "../handlers/revisionHandlers";

const router = Router();

router.get("/:id", getRevisions);

export default router;
