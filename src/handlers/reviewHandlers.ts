import { NextFunction, Request, Response } from "express";
import { and, desc, eq, notExists } from "drizzle-orm";
import { db } from "..";
import { validateToken } from "../middlewares/protected";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import { profiles } from "../models/profiles";
import { files } from "../models/files";
import { documentSupervisors } from "../models/document_supervisors";
import { approvalComments } from "../models/approval_comments";
import { successMessages } from "../utils/successMessages";
import { supabase } from "../utils/supabase";
import { DrizzleErrorCode } from "../types/drizzleError";
import { folders } from "../models/folders";
import { categories } from "../models/categories";
import { convertExcelBufferToEditorContent } from "../utils/excelUtils";
import {
  convertWordDocumentXmlToTiptap,
  extractWordDocumentParts,
} from "../utils/wordUtils";

const REVIEW_STATUS = {
  accepted: "accepted",
  approved: "approved",
  declined: "declined",
} as const;

const VIEWABLE_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);

const processReviewDecision = async (
  req: Request,
  res: Response,
  next: NextFunction,
  decision: typeof REVIEW_STATUS.approved | typeof REVIEW_STATUS.declined,
) => {
  try {
    const { id, comment } = req.body as {
      id?: string;
      comment?: string;
    };

    if (!id) {
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);
    }

    const userData = await validateToken(req.headers.authorization);

    const review = await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile) {
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);
      }

      const [currentReview] = await tx
        .select()
        .from(documentSupervisors)
        .where(eq(documentSupervisors.id, id))
        .limit(1);

      if (!currentReview) {
        throw new CustomError(errors.reviewNotFound, HttpStatusCode.NOT_FOUND);
      }

      if (currentReview.supervisorId !== profile.id) {
        throw new CustomError(
          errors.reviewNotAllowed,
          HttpStatusCode.FORBIDDEN,
        );
      }

      if (currentReview.status !== REVIEW_STATUS.accepted) {
        throw new CustomError(
          errors.reviewAlreadyProcessed,
          HttpStatusCode.BAD_REQUEST,
        );
      }

      const [existingDecision] = await tx
        .select()
        .from(approvalComments)
        .where(eq(approvalComments.documentSupervisorId, currentReview.id))
        .limit(1);

      if (existingDecision) {
        throw new CustomError(
          errors.reviewAlreadyProcessed,
          HttpStatusCode.BAD_REQUEST,
        );
      }

      const [createdDecision] = await tx
        .insert(approvalComments)
        .values({
          documentSupervisorId: currentReview.id,
          status: decision,
          comment:
            decision === REVIEW_STATUS.declined
              ? comment?.trim() || null
              : null,
          createdBy: profile.id,
        })
        .returning();

      if (!createdDecision) {
        throw new CustomError(
          errors.reviewNotUpdated,
          HttpStatusCode.BAD_REQUEST,
        );
      }

      return {
        review: currentReview,
        approvalComment: createdDecision,
      };
    });

    return res.status(HttpStatusCode.OK).json({
      message:
        decision === REVIEW_STATUS.approved
          ? successMessages.successApproveReview
          : successMessages.successDeclineReview,
      data: review,
    });
  } catch (e: any) {
    console.log(e);
    if (e.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const approveDocument = (
  req: Request,
  res: Response,
  next: NextFunction,
) => processReviewDecision(req, res, next, REVIEW_STATUS.approved);

export const declineDocument = (
  req: Request,
  res: Response,
  next: NextFunction,
) => processReviewDecision(req, res, next, REVIEW_STATUS.declined);

export const getReviewableFiles = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile) {
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);
      }

      const reviewableFiles = await tx
        .select({
          invitation: documentSupervisors,
          file: files,
        })
        .from(documentSupervisors)
        .innerJoin(files, eq(documentSupervisors.fileId, files.id))
        .where(
          and(
            eq(documentSupervisors.supervisorId, profile.id),
            eq(documentSupervisors.status, REVIEW_STATUS.accepted),
            eq(files.isDeleted, false),
            notExists(
              tx
                .select()
                .from(approvalComments)
                .where(
                  eq(
                    approvalComments.documentSupervisorId,
                    documentSupervisors.id,
                  ),
                ),
            ),
          ),
        )
        .orderBy(desc(documentSupervisors.respondedAt));

      const reviewedFiles = await tx
        .select({
          invitation: documentSupervisors,
          file: files,
        })
        .from(documentSupervisors)
        .innerJoin(files, eq(documentSupervisors.fileId, files.id))
        .where(
          and(
            eq(documentSupervisors.invitedBy, profile.id),
            eq(documentSupervisors.status, REVIEW_STATUS.accepted),
            eq(files.isDeleted, false),
          ),
        )
        .orderBy(desc(documentSupervisors.respondedAt));

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveReviewFiles,
        data: { reviewableFiles, reviewedFiles },
      });
    });
  } catch (e: any) {
    if (e.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const getReviewCommentsByFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);
    }

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile) {
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);
      }

      const [file] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, id), eq(files.isDeleted, false)))
        .limit(1);

      if (!file) {
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);
      }

      const supervisorMatch = await tx
        .select({ id: documentSupervisors.id })
        .from(documentSupervisors)
        .where(
          and(
            eq(documentSupervisors.fileId, id),
            eq(documentSupervisors.supervisorId, profile.id),
          ),
        )
        .limit(1);

      const isOwner = file.userId === profile.id;
      const isSupervisor = supervisorMatch.length > 0;

      if (!isOwner && !isSupervisor) {
        throw new CustomError(
          errors.fileNotAccessible,
          HttpStatusCode.FORBIDDEN,
        );
      }

      const comments = await tx
        .select({
          id: approvalComments.id,
          createdAt: approvalComments.createdAt,
          documentSupervisorId: approvalComments.documentSupervisorId,
          status: approvalComments.status,
          comment: approvalComments.comment,
          createdBy: approvalComments.createdBy,
          creator: {
            id: profiles.id,
            username: profiles.username,
          },
        })
        .from(approvalComments)
        .innerJoin(
          documentSupervisors,
          eq(approvalComments.documentSupervisorId, documentSupervisors.id),
        )
        .innerJoin(profiles, eq(approvalComments.createdBy, profiles.id))
        .where(eq(documentSupervisors.fileId, id))
        .orderBy(desc(approvalComments.createdAt));

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveReviewComments,
        data: {
          file,
          comments,
        },
      });
    });
  } catch (e: any) {
    if (e.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};
