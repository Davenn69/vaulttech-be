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
import { DrizzleErrorCode } from "../types/drizzleError";
import {
  convertWordDocumentXmlToTiptap,
  createBlankWordDocument,
  extractWordDocumentXml,
} from "../utils/wordUtils";

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

      const { error: bucketError } = await supabase.storage
        .from("Documents")
        .upload(filePath, documentBuffer, {
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          cacheControl: "3600",
          upsert: false,
        });

      console.log("bucket error");
      console.log(filePath);
      console.log(uniqueName);

      console.log(bucketError?.name);

      if (bucketError)
        throw new CustomError(bucketError.message, HttpStatusCode.BAD_REQUEST);

      console.log("file error");

      try {
        const [fileData] = await tx
          .insert(files)
          .values({
            userId: profile.id,
            folderId: profile.homeFolderId,
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

        return res.status(HttpStatusCode.CREATED).json({
          message: successMessages.successCreateWordFile,
          data: fileData,
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
    console.log(e.error);
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
