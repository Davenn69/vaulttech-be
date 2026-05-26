import { Router } from "express";
import { createPermission } from "../handlers/permissionHandlers";

const route = Router();

route.post("/", createPermission);

export default route;
