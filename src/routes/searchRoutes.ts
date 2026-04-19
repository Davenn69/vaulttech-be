import { Router } from "express";
import { searchData } from "../handlers/mixHandlers";

const router = Router();

router.get("/", searchData);

export default router;
