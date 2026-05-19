import { NextFunction, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "..";
import { validateToken } from "../middlewares/protected";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import { profiles } from "../models/profiles";
import { files } from "../models/files";
import { documentSupervisors } from "../models/document_supervisors";
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
} as const;

const VIEWABLE_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);

const createSignedUrl = async (filePath: string) => {
  const { data, error } = await supabase.storage
    .from("Documents")
    .createSignedUrl(filePath, 3600);

  if (error || !data) {
    throw new CustomError(errors.unableToLoadFile, HttpStatusCode.BAD_REQUEST);
  }

  return data.signedUrl;
};

const getReviewedFileContent = async (file: typeof files.$inferSelect) => {
  const extension = file.extension.toLowerCase();

  const { data: bucketFile, error: bucketError } = await supabase.storage
    .from("Documents")
    .download(file.path);

  if (bucketError || !bucketFile) {
    throw new CustomError(
      errors.downloadFileFailed,
      HttpStatusCode.BAD_REQUEST,
    );
  }

  const buffer = Buffer.from(await bucketFile.arrayBuffer());

  if (extension === "docx") {
    const { documentXml, numberingXml } = extractWordDocumentParts(buffer);
    return {
      type: "word",
      content: convertWordDocumentXmlToTiptap(documentXml, numberingXml),
    };
  }

  if (extension === "xlsx") {
    const { sheetName, content } = convertExcelBufferToEditorContent(buffer);
    return {
      type: "excel",
      sheetName,
      content,
    };
  }

  if (extension === "pdf" || VIEWABLE_IMAGE_EXTENSIONS.has(extension)) {
    return {
      type: "preview",
      previewUrl: await createSignedUrl(file.path),
    };
  }

  return {
    type: "file",
    previewUrl: await createSignedUrl(file.path),
  };
};

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
        .leftJoin(folders, eq(files.folderId, folders.id))
        .leftJoin(categories, eq(files.categoryId, categories.id))
        .where(
          and(
            eq(documentSupervisors.supervisorId, profile.id),
            eq(documentSupervisors.status, REVIEW_STATUS.accepted),
            eq(files.isDeleted, false),
          ),
        )
        .orderBy(desc(documentSupervisors.respondedAt));

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveReviewFiles,
        data: reviewableFiles,
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

export const getReviewableFileContent = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params as { id?: string };

    if (!id) {
      throw new CustomError(errors.fileIdMissing, HttpStatusCode.BAD_REQUEST);
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

      const [reviewAccess] = await tx
        .select()
        .from(documentSupervisors)
        .where(
          and(
            eq(documentSupervisors.fileId, file.id),
            eq(documentSupervisors.supervisorId, profile.id),
            eq(documentSupervisors.status, REVIEW_STATUS.accepted),
          ),
        )
        .limit(1);

      const canViewFile = file.userId === profile.id || Boolean(reviewAccess);

      if (!canViewFile) {
        throw new CustomError(
          errors.fileNotAccessible,
          HttpStatusCode.FORBIDDEN,
        );
      }

      const content = await getReviewedFileContent(file);

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveReviewFileContent,
        data: {
          file,
          ...content,
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
