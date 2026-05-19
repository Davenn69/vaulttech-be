import { Router } from "express";
import {
  acceptInvitation,
  createInvitation,
  declineInvitation,
  getInviteableUsers,
  getInvitations,
} from "../handlers/invitationHandlers";

const router = Router();

router.post("/", createInvitation);
router.get("/users", getInviteableUsers);
router.get("/", getInvitations);
router.patch("/accept", acceptInvitation);
router.patch("/decline", declineInvitation);

export default router;
