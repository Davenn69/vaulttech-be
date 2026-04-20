import { Router } from "express";
import { getRecent } from "../handlers/mixHandlers";

const router = Router();

router.get("/", getRecent);

export default router;
