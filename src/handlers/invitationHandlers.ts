import { NextFunction, Request, Response } from "express";
import { db } from "../db";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import { validateToken } from "../middlewares/protected";
import { DrizzleErrorCode } from "../types/drizzleError";
import { and, asc, desc, eq, ilike, ne, notExists } from "drizzle-orm";
import { profiles } from "../models/profiles";
import { files } from "../models/files";
import { documentSupervisors } from "../models/document_supervisors";
import { successMessages } from "../utils/successMessages";
import { authUsers } from "../models/auth";

const INVITATION_STATUS = {
  pending: "pending",
  accepted: "accepted",
  rejected: "rejected",
} as const;

export const createInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { fileId, supervisorId } = req.body as {
      fileId?: string;
      supervisorId?: string;
    };

    if (!fileId)
      throw new CustomError(errors.fileIdMissing, HttpStatusCode.BAD_REQUEST);

    if (!supervisorId)
      throw new CustomError(
        errors.supervisorIdMissing,
        HttpStatusCode.BAD_REQUEST,
      );

    const userData = await validateToken(req.headers.authorization);

    const invitation = await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [file] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), eq(files.userId, profile.id)))
        .limit(1);

      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const [supervisor] = await tx
        .select()
        .from(authUsers)
        .where(eq(authUsers.id, supervisorId))
        .limit(1);

      if (!supervisor)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [existingInvitation] = await tx
        .select()
        .from(documentSupervisors)
        .where(
          and(
            eq(documentSupervisors.fileId, fileId),
            eq(documentSupervisors.supervisorId, supervisorId),
            eq(documentSupervisors.status, INVITATION_STATUS.pending),
          ),
        )
        .limit(1);

      if (existingInvitation) {
        throw new CustomError(
          errors.invitationAlreadyExists,
          HttpStatusCode.CONFLICT,
        );
      }

      const [createdInvitation] = await tx
        .insert(documentSupervisors)
        .values({
          fileId,
          supervisorId,
          status: INVITATION_STATUS.pending,
          invitedBy: profile.id,
          invitedAt: new Date().toISOString(),
        })
        .returning();

      if (!createdInvitation)
        throw new CustomError(errors.invitationNotCreated, HttpStatusCode.BAD_REQUEST);

      return createdInvitation;
    });

    return res.status(HttpStatusCode.CREATED).json({
      message: successMessages.successCreateInvitation,
      data: invitation,
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const acceptInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.body as { id?: string };

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    const invitation = await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [currentInvitation] = await tx
        .select()
        .from(documentSupervisors)
        .where(eq(documentSupervisors.id, id))
        .limit(1);

      if (!currentInvitation)
        throw new CustomError(errors.invitationNotFound, HttpStatusCode.NOT_FOUND);

      if (currentInvitation.supervisorId !== profile.id) {
        throw new CustomError(errors.invitationNotAllowed, HttpStatusCode.FORBIDDEN);
      }

      if (currentInvitation.status !== INVITATION_STATUS.pending) {
        throw new CustomError(
          errors.invitationAlreadyProcessed,
          HttpStatusCode.BAD_REQUEST,
        );
      }

      const [updatedInvitation] = await tx
        .update(documentSupervisors)
        .set({
          status: INVITATION_STATUS.accepted,
          respondedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(documentSupervisors.id, id),
            eq(documentSupervisors.supervisorId, profile.id),
          ),
        )
        .returning();

      if (!updatedInvitation)
        throw new CustomError(errors.invitationNotUpdated, HttpStatusCode.BAD_REQUEST);

      return updatedInvitation;
    });

    return res.status(HttpStatusCode.OK).json({
      message: successMessages.successAcceptInvitation,
      data: invitation,
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const declineInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.body as { id?: string };

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    const invitation = await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [currentInvitation] = await tx
        .select()
        .from(documentSupervisors)
        .where(eq(documentSupervisors.id, id))
        .limit(1);

      if (!currentInvitation)
        throw new CustomError(errors.invitationNotFound, HttpStatusCode.NOT_FOUND);

      if (currentInvitation.supervisorId !== profile.id) {
        throw new CustomError(
          errors.invitationNotAllowedToDecline,
          HttpStatusCode.FORBIDDEN,
        );
      }

      if (currentInvitation.status !== INVITATION_STATUS.pending) {
        throw new CustomError(
          errors.invitationAlreadyProcessed,
          HttpStatusCode.BAD_REQUEST,
        );
      }

      const [updatedInvitation] = await tx
        .update(documentSupervisors)
        .set({
          status: INVITATION_STATUS.rejected,
          respondedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(documentSupervisors.id, id),
            eq(documentSupervisors.supervisorId, profile.id),
          ),
        )
        .returning();

      if (!updatedInvitation)
        throw new CustomError(errors.invitationNotUpdated, HttpStatusCode.BAD_REQUEST);

      return updatedInvitation;
    });

    return res.status(HttpStatusCode.OK).json({
      message: successMessages.successDeclineInvitation,
      data: invitation,
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const getInvitations = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { status } = req.query as { status?: string };

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const invitationConditions = [eq(documentSupervisors.supervisorId, profile.id)];

      if (status) {
        invitationConditions.push(eq(documentSupervisors.status, status));
      }

      const invitations = await tx
        .select({
          invitation: documentSupervisors,
          file: files,
        })
        .from(documentSupervisors)
        .innerJoin(files, eq(documentSupervisors.fileId, files.id))
        .where(and(...invitationConditions))
        .orderBy(desc(documentSupervisors.invitedAt));

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveInvitations,
        data: invitations,
      });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const getInviteableUsers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { search = "", fileId } = req.query as {
      search?: string;
      fileId?: string;
    };

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const userConditions = [
        eq(profiles.isActive, true),
        ne(profiles.id, profile.id),
      ];

      if (search) {
        userConditions.push(ilike(profiles.username, `%${search}%`));
      }

      if (fileId) {
        userConditions.push(
          notExists(
            tx
              .select()
              .from(documentSupervisors)
              .where(
                and(
                  eq(documentSupervisors.fileId, fileId),
                  eq(documentSupervisors.supervisorId, profiles.id),
                ),
              ),
          ),
        );
      }

      const users = await tx
        .select({
          id: profiles.id,
          username: profiles.username,
          isActive: profiles.isActive,
        })
        .from(profiles)
        .where(and(...userConditions))
        .orderBy(asc(profiles.username));

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveInviteableUsers,
        data: users,
      });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};
