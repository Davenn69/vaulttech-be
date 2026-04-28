import { Request, Response, NextFunction } from "express";
import { DrizzleErrorCode } from "../types/drizzleError";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import { validateToken } from "../middlewares/protected";
import { db } from "..";
import { eq, and } from "drizzle-orm";
import { profiles } from "../models/profiles";
import { files } from "../models/files";
import { supabase } from "../utils/supabase";

export const getPdfFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params as { id?: string };
    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [file] = await tx
        .select()
        .from(files)
        .where(
          and(
            eq(files.id, id),
            eq(files.userId, profile.id),
            eq(files.isDeleted, false),
            eq(files.extension, "pdf"),
          ),
        )
        .limit(1);

      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const { data: bucketFile, error: bucketError } = await supabase.storage
        .from("Documents")
        .download(file.path);

      if (bucketError || !bucketFile)
        throw new CustomError(
          errors.downloadFileFailed,
          HttpStatusCode.BAD_REQUEST,
        );
    });
  } catch (e) {
    if ((e as any)?.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode((e as any).cause.code));
    } else {
      next(e);
    }
  }
};
