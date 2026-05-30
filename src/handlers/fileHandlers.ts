import { Request, Response, NextFunction } from "express";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import path from "path";
import { createHash } from "crypto";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";
import { v4 as uuidv4 } from "uuid";
import { db } from "..";
import { profiles } from "../models/profiles";
import { eq, and, ilike, count, SQL, desc, asc, inArray } from "drizzle-orm";
import { files } from "../models/files";
import { categories } from "../models/categories";
import { DrizzleErrorCode } from "../types/drizzleError";
import { folders } from "../models/folders";
import { HttpStatusCode } from "../types/httpStatusCode";
import { PaginationParams } from "../types/pagination";
import { validateToken } from "../middlewares/protected";
import { createClient } from "@supabase/supabase-js";
import { documentSupervisors } from "../models/document_supervisors";
import { filePermissions } from "../models/file_permissions";
import { fileRevisions } from "../models/file_revisions";
import {
  buildFileRevisionBasePath,
  buildInitialRevisionStorageKey,
} from "../utils/fileStorage";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);

const buildFileHash = (buffer: Buffer) => {
  return createHash("sha256").update(buffer).digest("hex");
};

type SharedPermission = {
  id: number;
  createdAt: string;
  isActive: boolean;
  permissionType: string;
  grantedBy: string;
  grantedTo: string;
};

const getImagePreviewUrl = async (filePath: string, extension?: string) => {
  if (!extension || !IMAGE_EXTENSIONS.has(extension.toLowerCase())) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from("Documents")
    .createSignedUrl(filePath, 3600);

  if (error) {
    return null;
  }

  return data.signedUrl;
};

export const uploadFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { folderId } = req.body;
    if (!req.file)
      throw new CustomError(errors.fileMissing, HttpStatusCode.BAD_REQUEST);

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

      const file = req.file!;
      const fileExt = path.extname(file.originalname).replaceAll(".", "");
      const fileSize = file.size;
      const fileName = file.originalname.split(".")[0]!;
      const uniqueName = uuidv4();
      const filePath = buildInitialRevisionStorageKey(
        buildFileRevisionBasePath(profile.id, folderId, uniqueName),
        fileExt,
      );
      const fileHash = buildFileHash(file.buffer);

      const { error: bucketError } = await supabase.storage
        .from("Documents")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          cacheControl: "3600",
        });

      if (bucketError)
        throw new CustomError(bucketError.message, HttpStatusCode.BAD_REQUEST);

      try {
        const [fileData] = await tx
          .insert(files)
          .values({
            userId: profile.id,
            extension: fileExt,
            name: fileName,
            createdBy: profile.username,
            size: fileSize,
            path: filePath,
            folderId: folderId,
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
            size: fileSize,
          })
          .returning();

        if (!revisionData)
          throw new CustomError(
            errors.uploadFileFailed,
            HttpStatusCode.BAD_REQUEST,
          );

        res
          .status(HttpStatusCode.CREATED)
          .json({ message: successMessages.successUpload, data: fileData });
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
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const getFiles = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    const {
      page = 1,
      limit = 10,
      sort_order = "asc",
      search = "",
    } = req.query as PaginationParams;

    if (page < 1 || limit < 1) {
      throw new CustomError(
        errors.negativePageNumbers,
        HttpStatusCode.BAD_REQUEST,
      );
    }

    const limitNum = Number(limit);
    const pageNum = Number(page);

    const offset = (pageNum - 1) * limitNum;

    if (!id)
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

      const fileQueryConditions: SQL[] = [
        eq(files.folderId, id),
        eq(files.userId, userData.user.id),
        eq(files.isDeleted, false),
      ];

      if (search) {
        fileQueryConditions.push(ilike(files.name, `%${search}%`));
      }

      const countQuery = await tx
        .select({ total: count() })
        .from(files)
        .innerJoin(categories, eq(files.categoryId, categories.id))
        .where(and(...fileQueryConditions));
      const totalItems = countQuery[0]!.total;

      const file = await tx
        .select({
          file: files,
          category: {
            id: categories.id,
            name: categories.name,
            color: categories.color,
            createdAt: categories.createdAt,
            updatedAt: categories.updatedAt,
          },
        })
        .from(files)
        .fullJoin(categories, eq(files.categoryId, categories.id))
        .limit(limitNum)
        .offset(offset)
        .orderBy(sort_order === "desc" ? desc(files.name) : asc(files.name))
        .where(and(...fileQueryConditions));

      const filesWithCategory = file.map(({ file, category }) => ({
        ...file,
        category,
      }));

      const totalPages = Math.ceil(totalItems / limitNum);
      const hasNextPage = pageNum < totalPages;
      const hasPrevPage = pageNum > 1;

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveFiles,
        meta: {
          current_page: page,
          total_items: totalItems,
          total_pages: totalPages,
          has_next_page: hasNextPage,
          has_prev_page: hasPrevPage,
        },
        data: filesWithCategory,
      });
    });
  } catch (e: any) {
    console.log(e);
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const getSharedFiles = async (
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

      const sharedFileRows = await tx
        .select({
          file: files,
          permission: {
            id: filePermissions.id,
            createdAt: filePermissions.createdAt,
            isActive: filePermissions.isActive,
            permissionType: filePermissions.permissionType,
            grantedBy: filePermissions.grantedBy,
            grantedTo: filePermissions.grantedTo,
          },
        })
        .from(filePermissions)
        .innerJoin(files, eq(filePermissions.fileId, files.id))
        .where(
          and(
            eq(filePermissions.grantedTo, profile.id),
            eq(filePermissions.isActive, true),
            eq(files.isDeleted, false),
          ),
        )
        .orderBy(desc(filePermissions.createdAt));

      const sharedFilesMap = new Map<
        string,
        {
          [key: string]: any;
          permissions: SharedPermission[];
        }
      >();

      for (const row of sharedFileRows) {
        if (row.permission.grantedBy === profile.id) {
          continue;
        }

        const existingFile = sharedFilesMap.get(row.file.id);

        if (!existingFile) {
          sharedFilesMap.set(row.file.id, {
            ...row.file,
            permissions: [row.permission],
          });
          continue;
        }

        existingFile.permissions.push(row.permission);
      }

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveSharedFiles,
        data: Array.from(sharedFilesMap.values()),
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

export const updateName = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id, name } = req.body;

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);
    if (!name)
      throw new CustomError(errors.nameMissing, HttpStatusCode.BAD_REQUEST);

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
        .update(files)
        .set({ name: name })
        .where(and(eq(files.id, id), eq(files.userId, userData.user.id)))
        .returning();

      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successUpdateFile, data: file });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      return next(new DrizzleErrorCode(e.cause.code));
    } else {
      return next(e);
    }
  }
};

export const addFileToCertainCategory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id, categoryId } = req.body;

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);
    if (!categoryId)
      throw new CustomError(
        errors.categoryIdMissing,
        HttpStatusCode.BAD_REQUEST,
      );

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [category] = await tx
        .select()
        .from(categories)
        .where(eq(categories.id, categoryId))
        .limit(1);

      if (!category)
        throw new CustomError(
          errors.categoryNotFound,
          HttpStatusCode.NOT_FOUND,
        );

      const [file] = await tx
        .update(files)
        .set({ categoryId })
        .where(and(eq(files.id, id), eq(files.userId, userData.user.id)))
        .returning();

      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successUpdateFile,
        data: file,
      });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      return next(new DrizzleErrorCode(e.cause.code));
    } else {
      return next(e);
    }
  }
};

export const removeFileFromCertainCategory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.body;

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
        .update(files)
        .set({ categoryId: null })
        .where(and(eq(files.id, id), eq(files.userId, userData.user.id)))
        .returning();

      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successUpdateFile,
        data: file,
      });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      return next(new DrizzleErrorCode(e.cause.code));
    } else {
      return next(e);
    }
  }
};

export const deleteFile = async (
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
        .update(files)
        .set({ isDeleted: true, isFavourite: false })
        .where(
          and(
            eq(files.id, id),
            eq(files.userId, userData.user.id),
            eq(files.isDeleted, false),
          ),
        )
        .returning();

      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.BAD_REQUEST);

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successDeleteFile, data: file });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const deletePermanentFile = async (
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
            eq(files.userId, userData.user.id),
            eq(files.isDeleted, true),
          ),
        )
        .limit(1);

      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const { error: bucketError } = await supabase.storage
        .from("Documents")
        .remove([file.path]);

      if (bucketError) {
        throw new CustomError(
          errors.fileDeleteFailed,
          HttpStatusCode.INTERNAL_SERVER_ERROR,
        );
      }

      const [deletedFile] = await tx
        .delete(files)
        .where(
          and(
            eq(files.id, id),
            eq(files.userId, userData.user.id),
            eq(files.isDeleted, true),
          ),
        )
        .returning();

      if (!deletedFile)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successPermanentDeleteFile,
        data: deletedFile,
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

export const restoreFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.body;
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
        .update(files)
        .set({ isDeleted: false })
        .where(
          and(
            eq(files.isDeleted, true),
            eq(files.userId, profile.id),
            eq(files.id, id),
          ),
        )
        .returning();
      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successRestoreFile, data: file });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const moveFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { fileId, newFolderId } = req.body;

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
        .update(files)
        .set({ folderId: newFolderId })
        .where(and(eq(files.id, fileId), eq(files.userId, userData.user.id)))
        .returning();

      if (!file)
        throw new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND);

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successMoveFile, data: file });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const getDeletedFiles = async (
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

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const file = await tx
        .select()
        .from(files)
        .where(
          and(eq(files.userId, userData.user.id), eq(files.isDeleted, true)),
        );

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successRetrieveFiles, data: file });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const downloadFile = async (
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
            eq(files.userId, userData.user.id),
            eq(files.id, id),
            eq(files.isDeleted, false),
          ),
        );

      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const { data: bucketData, error: bucketError } = await supabase.storage
        .from("Documents")
        .createSignedUrl(file.path, 3600, {
          download: file.name,
        });
      if (bucketError)
        return next(new CustomError(errors.downloadFileFailed, 400));

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successDownloadFile,
        data: {
          downloadUrl: bucketData.signedUrl,
          name: file.name,
          size: file.size,
        },
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

export const selectFavourites = async (
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
      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const file = await tx
        .select()
        .from(files)
        .where(
          and(
            eq(files.userId, userData.user.id),
            eq(files.isFavourite, true),
            eq(files.isDeleted, false),
          ),
        );

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successRetrieveFiles, data: file });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const addFavourite = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.body;

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(and(eq(profiles.id, userData.user.id)));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [file] = await tx
        .update(files)
        .set({ isFavourite: true })
        .where(
          and(
            eq(files.userId, userData.user.id),
            eq(files.id, id),
            eq(files.isFavourite, false),
          ),
        )
        .returning();
      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successAddFavourite, data: file });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const removeFavourite = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.body;

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(and(eq(profiles.id, userData.user.id)));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [file] = await tx
        .update(files)
        .set({ isFavourite: false })
        .where(
          and(
            eq(files.userId, userData.user.id),
            eq(files.id, id),
            eq(files.isFavourite, true),
          ),
        )
        .returning();
      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successRemoveFavourite, data: file });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const getPhotoUrl = async (
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
        .where(and(eq(profiles.id, userData.user.id)));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      console.log(`id ${id}`);

      const [file] = await tx
        .update(files)
        .set({ isFavourite: false })
        .where(
          and(
            eq(files.userId, userData.user.id),
            eq(files.id, id),
            inArray(files.extension, ["jpg", "png", "jpeg"]),
          ),
        )
        .returning();
      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const { data, error } = await supabase.storage
        .from("Documents")
        .createSignedUrl(file.path, 3600);

      console.log(`file path ${file.path}`);

      if (error) {
        throw new CustomError(
          errors.unableToLoadPhoto,
          HttpStatusCode.INTERNAL_SERVER_ERROR,
        );
      }

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successGetPhoto,
        data: {
          file,
          signedUrl: data.signedUrl,
        },
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

export const getFileUrl = async (
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
        .where(and(eq(profiles.id, userData.user.id)));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [file] = await tx.select().from(files).where(eq(files.id, id));
      if (!file)
        throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);

      const { data, error } = await supabase.storage
        .from("Documents")
        .createSignedUrl(file.path, 3600);

      console.log(file.path);

      console.log(error);

      if (error) {
        throw new CustomError(
          errors.unableToLoadFile,
          HttpStatusCode.INTERNAL_SERVER_ERROR,
        );
      }

      const officeViewerUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(data.signedUrl)}`;

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successGetPhoto,
        data: {
          file,
          url: officeViewerUrl,
        },
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
