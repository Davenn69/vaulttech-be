import { Request, Response, NextFunction } from "express";
import { validateToken } from "../middlewares/protected";
import { db } from "../db";
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
  convertExcelBufferToEditorContent,
  createExcelDocumentFromEditorContent,
  createBlankExcelDocument,
} from "../utils/excelUtils";
import {
  buildFileRevisionBasePath,
  buildInitialRevisionStorageKey,
  buildNextRevisionStorageKey,
  resolveFileRevisionBasePath,
} from "../utils/fileStorage";
import { createClient } from "@supabase/supabase-js";

const buildFileHash = (buffer: Buffer) => {
  return createHash("sha256").update(buffer).digest("hex");
};

const parseExcelContent = (content: unknown) => {
  if (typeof content !== "string") {
    return content;
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new CustomError(errors.missingBody, HttpStatusCode.BAD_REQUEST);
  }
};

export const createExcelFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { folderId } = req.body;

    if (!folderId)
      throw new CustomError(errors.folderIdMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    const supabaseUser = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: req.headers.authorization ?? "",
          },
        },
      },
    );

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

      const documentBuffer = createBlankExcelDocument();
      const fileId = uuidv4();
      const fileName = "Untitled";
      const fileExt = "xlsx";
      const uniqueName = uuidv4();
      const filePath = buildInitialRevisionStorageKey(
        buildFileRevisionBasePath(profile.id, folderId, fileId, uniqueName),
        fileExt,
      );
      const fileHash = buildFileHash(documentBuffer);

      const { error: bucketError } = await supabaseUser.storage
        .from("Documents")
        .upload(filePath, documentBuffer, {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          cacheControl: "3600",
          upsert: false,
        });

      if (bucketError)
        throw new CustomError(bucketError.message, HttpStatusCode.BAD_REQUEST);

      try {
        const [fileData] = await tx
          .insert(files)
          .values({
            id: fileId,
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
          message: successMessages.successCreateExcelFile,
          file: fileData,
          revision: revisionData,
        });
      } catch (error) {
        try {
          await supabaseUser.storage.from("Documents").remove([filePath]);
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

export const getExcelFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params as { id: string };

    if (!id)
      throw new CustomError(errors.fileIdMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    const supabaseUser = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: req.headers.authorization ?? "",
          },
        },
      },
    );

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(and(eq(profiles.id, userData.user.id)));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      if (!profile.homeFolderId)
        throw new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND);

      const [file] = await tx
        .select()
        .from(files)
        .where(
          and(
            eq(files.id, id),
            eq(files.userId, userData.user.id),
            eq(files.isDeleted, false),
          ),
        )
        .limit(1);

      if (!file || file.userId !== profile.id || file.isDeleted)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const { data: bucketFile, error: bucketError } =
        await supabaseUser.storage.from("Documents").download(file.path);

      if (bucketError || !bucketFile)
        throw new CustomError(
          errors.downloadFileFailed,
          HttpStatusCode.BAD_REQUEST,
        );

      const buffer = Buffer.from(await bucketFile.arrayBuffer());
      const { sheetName, content } = convertExcelBufferToEditorContent(buffer);

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveExcelFile,
        data: {
          file,
          sheetName,
          content,
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

export const saveExcelFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id, content, sheetName } = req.body;

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);
    if (content === undefined || content === null || content === "")
      throw new CustomError(errors.missingBody, HttpStatusCode.BAD_REQUEST);

    const parsedContent = parseExcelContent(content);
    const documentBuffer = createExcelDocumentFromEditorContent(
      parsedContent,
      typeof sheetName === "string" && sheetName.length > 0
        ? sheetName
        : "Sheet1",
    );

    const userData = await validateToken(req.headers.authorization);

    const supabaseUser = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: req.headers.authorization ?? "",
          },
        },
      },
    );

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

      if (!file)
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
      const storageBasePath = resolveFileRevisionBasePath(file.path);
      const storageKey = buildNextRevisionStorageKey(
        storageBasePath,
        file.extension,
        nextVersion,
      );
      const fileHash = buildFileHash(documentBuffer);

      const { error: bucketError } = await supabaseUser.storage
        .from("Documents")
        .upload(storageKey, documentBuffer, {
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
          message: successMessages.successSaveExcelFile,
          data: {
            file: updatedFile,
            revision: revisionData,
          },
        });
      } catch (error) {
        try {
          await supabaseUser.storage.from("Documents").remove([storageKey]);
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
