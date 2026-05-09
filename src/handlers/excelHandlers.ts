import { Request, Response, NextFunction } from "express";
import { validateToken } from "../middlewares/protected";
import { db } from "..";
import { profiles } from "../models/profiles";
import { and, eq } from "drizzle-orm";
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
  convertExcelWorksheetXmlToGrid,
  createBlankExcelDocument,
  extractExcelSheetName,
  extractExcelWorkbookXml,
  extractExcelWorksheetXml,
} from "../utils/excelUtils";

const buildFileHash = (buffer: Buffer) => {
  return createHash("sha256").update(buffer).digest("hex");
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
      const fileName = "Untitled";
      const fileExt = "xlsx";
      const uniqueName = `${uuidv4()}.${fileExt}`;
      const filePath = `${profile.id}/${folderId}/${uniqueName}`;
      const fileHash = buildFileHash(documentBuffer);

      const { error: bucketError } = await supabase.storage
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

      const { data: bucketFile, error: bucketError } = await supabase.storage
        .from("Documents")
        .download(file.path);

      if (bucketError || !bucketFile)
        throw new CustomError(
          errors.downloadFileFailed,
          HttpStatusCode.BAD_REQUEST,
        );

      const buffer = Buffer.from(await bucketFile.arrayBuffer());
      const workbookXml = extractExcelWorkbookXml(buffer);
      const worksheetXml = extractExcelWorksheetXml(buffer);
      const sheetName = extractExcelSheetName(workbookXml);
      const content = convertExcelWorksheetXmlToGrid(worksheetXml);

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
