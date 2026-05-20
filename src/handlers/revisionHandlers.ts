import { NextFunction, Request, Response } from "express";
import { DrizzleErrorCode } from "../types/drizzleError";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import { db } from "..";
import { profiles } from "../models/profiles";
import { and, eq } from "drizzle-orm";
import { validateToken } from "../middlewares/protected";
import { files } from "../models/files";
import { fileRevisions } from "../models/file_revisions";
import { successMessages } from "../utils/successMessages";

export const getRevisions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params as { id?: string };
    if (!id)
      throw new CustomError(errors.fileIdMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    db.transaction(async (tx) => {
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
        .where(and(eq(files.id, id)))
        .limit(1);

      if (!file || file.isDeleted)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const revisions = await tx
        .select()
        .from(fileRevisions)
        .where(and(eq(fileRevisions.fileId, id)))
        .orderBy(fileRevisions.createdAt);

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successGetFileHistory,
        data: {
          file,
          revisions,
        },
      });
    });
  } catch (e) {
    if ((e as any)?.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode((e as any).cause.code));
    } else {
      next(e);
    }
  }
};
