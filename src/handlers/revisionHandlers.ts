import { NextFunction, Request, Response } from "express";
import { DrizzleErrorCode } from "../types/drizzleError";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import { db } from "..";
import { profiles } from "../models/profiles";
import { and, desc, eq } from "drizzle-orm";
import { validateToken } from "../middlewares/protected";
import { files } from "../models/files";
import { fileRevisions } from "../models/file_revisions";
import { successMessages } from "../utils/successMessages";
import { supabase } from "../utils/supabase";
import { createHash } from "crypto";
import {
  buildNextRevisionStorageKey,
  resolveFileRevisionBasePath,
} from "../utils/fileStorage";

const buildFileHash = (buffer: Buffer) => {
  return createHash("sha256").update(buffer).digest("hex");
};

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

export const revertRevision = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { fileId, revisionId } = req.params as {
      fileId?: string;
      revisionId?: string;
    };

    if (!fileId)
      throw new CustomError(errors.fileIdMissing, HttpStatusCode.BAD_REQUEST);
    if (!revisionId)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
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

      if (!file || file.isDeleted)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const [revision] = await tx
        .select()
        .from(fileRevisions)
        .where(and(eq(fileRevisions.id, revisionId), eq(fileRevisions.fileId, fileId)))
        .limit(1);

      if (!revision)
        throw new CustomError(
          errors.revisionNotFound,
          HttpStatusCode.NOT_FOUND,
        );

      const [latestRevision] = await tx
        .select({
          versionNumber: fileRevisions.versionNumber,
        })
        .from(fileRevisions)
        .where(eq(fileRevisions.fileId, file.id))
        .orderBy(desc(fileRevisions.versionNumber))
        .limit(1);

      const nextVersion = Number(latestRevision?.versionNumber ?? 0) + 1;
      const storageBasePath = resolveFileRevisionBasePath(file.path);
      const extension = file.extension || revision.storageKey.split(".").pop() || "";
      const storageKey = buildNextRevisionStorageKey(
        storageBasePath,
        extension,
        nextVersion,
      );

      const { data: revisionBlob, error: downloadError } = await supabase.storage
        .from("Documents")
        .download(revision.storageKey);

      if (downloadError || !revisionBlob)
        throw new CustomError(
          errors.downloadFileFailed,
          HttpStatusCode.BAD_REQUEST,
        );

      const buffer = Buffer.from(await revisionBlob.arrayBuffer());
      const fileHash = buildFileHash(buffer);

      const { error: uploadError } = await supabase.storage
        .from("Documents")
        .upload(storageKey, buffer, {
          contentType: "application/octet-stream",
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError)
        throw new CustomError(uploadError.message, HttpStatusCode.BAD_REQUEST);

      try {
        const [updatedFile] = await tx
          .update(files)
          .set({
            path: storageKey,
            size: revision.size,
            updatedAt: new Date().toISOString(),
            updatedBy: profile.username,
          })
          .where(and(eq(files.id, file.id), eq(files.userId, profile.id)))
          .returning();

        if (!updatedFile)
          throw new CustomError(
            errors.fileNotFound,
            HttpStatusCode.NOT_FOUND,
          );

        const [revertRevision] = await tx
          .insert(fileRevisions)
          .values({
            fileId: file.id,
            versionNumber: nextVersion,
            storageKey,
            fileHash,
            size: revision.size,
          })
          .returning();

        if (!revertRevision)
          throw new CustomError(
            errors.uploadFileFailed,
            HttpStatusCode.BAD_REQUEST,
          );

        return res.status(HttpStatusCode.OK).json({
          message: successMessages.successRevertFile,
          data: {
            file: updatedFile,
            revision: revertRevision,
          },
        });
      } catch (error) {
        try {
          await supabase.storage.from("Documents").remove([storageKey]);
        } catch {
          // Best effort cleanup only.
        }
        throw error;
      }
    });
  } catch (e) {
    if ((e as any)?.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode((e as any).cause.code));
    } else {
      next(e);
    }
  }
};

export const downloadRevision = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { fileId, revisionId } = req.params as {
      fileId?: string;
      revisionId?: string;
    };

    if (!fileId)
      throw new CustomError(errors.fileIdMissing, HttpStatusCode.BAD_REQUEST);
    if (!revisionId)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
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

      if (!file || file.isDeleted)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const [revision] = await tx
        .select()
        .from(fileRevisions)
        .where(
          and(eq(fileRevisions.id, revisionId), eq(fileRevisions.fileId, fileId)),
        )
        .limit(1);

      if (!revision)
        throw new CustomError(
          errors.revisionNotFound,
          HttpStatusCode.NOT_FOUND,
        );

      const revisionFileName = `${file.name}_v${revision.versionNumber}.${file.extension}`;
      const { data, error } = await supabase.storage
        .from("Documents")
        .createSignedUrl(revision.storageKey, 3600, {
          download: revisionFileName,
        });

      if (error || !data)
        throw new CustomError(
          errors.downloadFileFailed,
          HttpStatusCode.BAD_REQUEST,
        );

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successDownloadFileRevision,
        data: {
          file,
          revision,
          downloadUrl: data.signedUrl,
          name: revisionFileName,
          size: revision.size,
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
