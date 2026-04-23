import { Request, Response, NextFunction } from "express";
import { validateToken } from "../middlewares/protected";
import { db } from "..";
import { profiles } from "../models/profiles";
import { and, desc, eq } from "drizzle-orm";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import { supabase } from "../utils/supabase";
import { v4 as uuidv4 } from "uuid";
import { successMessages } from "../utils/successMessages";
import { files } from "../models/files";
import { fileRevisions } from "../models/file_revisions";
import { DrizzleErrorCode } from "../types/drizzleError";
import { createHash } from "crypto";
import {
  convertWordDocumentXmlToTiptap,
  createBlankWordDocument,
  createWordDocumentFromTiptap,
  extractWordDocumentXml,
} from "../utils/wordUtils";

const buildFileHash = (buffer: Buffer) => {
  return createHash("sha256").update(buffer).digest("hex");
};

const parseWordContent = (content: unknown) => {
  if (typeof content !== "string") {
    return content;
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new CustomError(errors.missingBody, HttpStatusCode.BAD_REQUEST);
  }
};

export const createWordFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { folderId } = req.body;

    if (!folderId)
      throw new CustomError(errors.folderIdMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      if (!profile.homeFolderId)
        throw new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND);

      const documentBuffer = createBlankWordDocument();
      const fileName = "Untitled";
      const fileExt = "docx";
      const uniqueName = `${uuidv4()}.${fileExt}`;
      const filePath = `${profile.id}/${folderId}/${uniqueName}`;
      const fileHash = buildFileHash(documentBuffer);

      const { error: bucketError } = await supabase.storage
        .from("Documents")
        .upload(filePath, documentBuffer, {
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          cacheControl: "3600",
          upsert: false,
        });

      if (bucketError)
        throw new CustomError(bucketError.message, HttpStatusCode.BAD_REQUEST);

      try {
        const [fileData] = await tx
          .insert(files)
          .values({
            userId: profile.id,
            folderId,
            name: fileName,
            createdBy: profile.username,
            extension: fileExt,
            size: documentBuffer.length,
            path: filePath,
          })
          .returning();

        if (!fileData)
          throw new CustomError(
            errors.uploadFileFailed,
            HttpStatusCode.BAD_REQUEST,
          );

        const [revisionData] = await tx
          .insert(fileRevisions)
          .values({
            fileId: fileData.id,
            versionNumber: 1,
            storageKey: filePath,
            fileHash,
            size: documentBuffer.length,
          })
          .returning();

        if (!revisionData)
          throw new CustomError(
            errors.uploadFileFailed,
            HttpStatusCode.BAD_REQUEST,
          );

        return res.status(HttpStatusCode.CREATED).json({
          message: successMessages.successCreateWordFile,
          data: {
            file: fileData,
            revision: revisionData,
          },
        });
      } catch (error) {
        try {
          await supabase.storage.from("Documents").remove([filePath]);
        } catch {
          // Best effort cleanup only.
        }
        throw error;
      }
    });
  } catch (e: any) {
    if ((e as any)?.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode((e as any).cause.code));
    } else {
      next(e);
    }
  }
};

export const getWordFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    if (!id)
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
        .where(
          and(
            eq(files.id, id),
            eq(files.userId, profile.id),
            eq(files.isDeleted, false),
          ),
        )
        .limit(1);

      if (!file || file.userId !== profile.id || file.isDeleted) {
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);
      }

      const { data: bucketFile, error: bucketError } = await supabase.storage
        .from("Documents")
        .download(file.path);

      if (bucketError || !bucketFile)
        throw new CustomError(
          errors.downloadFileFailed,
          HttpStatusCode.BAD_REQUEST,
        );

      const buffer = Buffer.from(await bucketFile.arrayBuffer());
      const documentXml = extractWordDocumentXml(buffer);
      const tiptapContent = convertWordDocumentXmlToTiptap(documentXml);

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveWordFile,
        data: {
          file,
          content: tiptapContent,
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

export const save = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, content } = req.body;

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);
    if (content === undefined || content === null || content === "")
      throw new CustomError(errors.missingBody, HttpStatusCode.BAD_REQUEST);

    const parsedContent = parseWordContent(content);
    const documentBuffer = createWordDocumentFromTiptap(parsedContent);

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
        .where(and(eq(files.id, id), eq(files.userId, profile.id)))
        .limit(1);

      if (!file || file.isDeleted)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const [latestRevision] = await tx
        .select({
          versionNumber: fileRevisions.versionNumber,
        })
        .from(fileRevisions)
        .where(eq(fileRevisions.fileId, file.id))
        .orderBy(desc(fileRevisions.versionNumber))
        .limit(1);

      const nextVersion = Number(latestRevision?.versionNumber ?? 0) + 1;
      const storageKey = `${profile.id}/${file.folderId}/${file.id}/revisions/${uuidv4()}.docx`;
      const fileHash = buildFileHash(documentBuffer);

      const { error: bucketError } = await supabase.storage
        .from("Documents")
        .upload(storageKey, documentBuffer, {
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          cacheControl: "3600",
          upsert: false,
        });

      if (bucketError)
        throw new CustomError(bucketError.message, HttpStatusCode.BAD_REQUEST);

      try {
        const [updatedFile] = await tx
          .update(files)
          .set({
            path: storageKey,
            size: documentBuffer.length,
            updatedAt: new Date().toISOString(),
            updatedBy: profile.username,
          })
          .where(and(eq(files.id, file.id), eq(files.userId, profile.id)))
          .returning();

        if (!updatedFile)
          throw new CustomError(
            errors.uploadFileFailed,
            HttpStatusCode.BAD_REQUEST,
          );

        const [revisionData] = await tx
          .insert(fileRevisions)
          .values({
            fileId: file.id,
            versionNumber: nextVersion,
            storageKey,
            fileHash,
            size: documentBuffer.length,
          })
          .returning();

        if (!revisionData)
          throw new CustomError(
            errors.uploadFileFailed,
            HttpStatusCode.BAD_REQUEST,
          );

        return res.status(HttpStatusCode.OK).json({
          message: successMessages.successSaveWordFile,
          data: {
            file: updatedFile,
            revision: revisionData,
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

export const getRevisions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { file_id: id } = req.params as { file_id?: string };
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
        .where(and(eq(files.id, id), eq(files.userId, profile.id)))
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
