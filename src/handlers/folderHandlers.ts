import { Request, Response, NextFunction } from "express";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";
import { db } from "..";
import { profiles } from "../models/profiles";
import { and, desc, eq, ilike } from "drizzle-orm";
import { folders } from "../models/folders";
import { DrizzleErrorCode } from "../types/drizzleError";
import { HttpStatusCode } from "../types/httpStatusCode";
import { validateToken } from "../middlewares/protected";
import { folderPermissions } from "../models/folder_permissions";

export const createFolder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { parentId, name } = req.body;

    if (!parentId)
      throw new CustomError(errors.folderIdMissing, HttpStatusCode.BAD_REQUEST);

    if (!name)
      throw new CustomError(errors.nameMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    const folder = await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [parentFolder] = await tx
        .select()
        .from(folders)
        .where(
          and(
            eq(folders.id, parentId),
            eq(folders.userId, profile.id),
            eq(folders.isDeleted, false),
          ),
        );

      if (!parentFolder)
        throw new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND);

      const [createdFolder] = await tx
        .insert(folders)
        .values({
          userId: profile.id,
          name: name,
          createdBy: profile.username,
          path: parentFolder.path,
          parentId: parentFolder.id,
        })
        .returning();

      if (!createdFolder)
        throw new CustomError(
          errors.folderNotCreated,
          HttpStatusCode.BAD_REQUEST,
        );

      return createdFolder;
    });

    return res.status(HttpStatusCode.CREATED).json({
      message: successMessages.successCreateFolder,
      data: folder,
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const getFolders = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { parentId } = req.params;
    const { name } = req.query;

    if (!parentId)
      throw new CustomError(errors.folderIdMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      var folder;
      if (!name) {
        folder = await tx
          .select()
          .from(folders)
          .where(
            and(
              eq(folders.parentId, parentId),
              eq(folders.userId, profile.id),
              eq(folders.isDeleted, false),
            ),
          );
      } else {
        folder = await tx
          .select()
          .from(folders)
          .where(
            and(
              eq(folders.parentId, parentId),
              eq(folders.userId, profile.id),
              eq(folders.isDeleted, false),
              ilike(folders.name, `%${name}%`),
            ),
          );
      }

      if (!folder)
        throw new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND);

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveFolders,
        data: folder,
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

type SharedPermission = {
  id: number;
  createdAt: string;
  isActive: boolean;
  permissionType: string;
  grantedBy: string;
  grantedTo: string;
};

export const getSharedFolders = async (
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

      const sharedFolderRows = await tx
        .select({
          folder: folders,
          permission: {
            id: folderPermissions.id,
            createdAt: folderPermissions.createdAt,
            isActive: folderPermissions.isActive,
            permissionType: folderPermissions.permissionType,
            grantedBy: folderPermissions.grantedBy,
            grantedTo: folderPermissions.grantedTo,
          },
        })
        .from(folderPermissions)
        .innerJoin(folders, eq(folderPermissions.folderId, folders.id))
        .where(
          and(
            eq(folderPermissions.grantedTo, profile.id),
            eq(folderPermissions.isActive, true),
            eq(folders.isDeleted, false),
          ),
        )
        .orderBy(desc(folderPermissions.createdAt));

      const sharedFoldersMap = new Map<
        string,
        {
          [key: string]: any;
          permissions: SharedPermission[];
        }
      >();

      for (const row of sharedFolderRows) {
        if (row.permission.grantedBy === profile.id) continue;

        const existingFolder = sharedFoldersMap.get(row.folder.id);

        if (!existingFolder) {
          sharedFoldersMap.set(row.folder.id, {
            ...row.folder,
            permissions: [row.permission],
          });
          continue;
        }

        existingFolder.permissions.push(row.permission);
      }

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveSharedFolders,
        data: Array.from(sharedFoldersMap.values()),
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

export const updateFolder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id, name } = req.body;

    if (!id)
      throw new CustomError(errors.folderIdMissing, HttpStatusCode.BAD_REQUEST);

    if (!name)
      throw new CustomError(errors.nameMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [folder] = await tx
        .update(folders)
        .set({ name: name })
        .where(and(eq(folders.userId, userData.user.id), eq(folders.id, id)))
        .returning();

      if (!folder)
        throw new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND);

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successUpdateFolder, data: folder });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const deleteFolder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;

    if (!id)
      throw new CustomError(errors.folderIdMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [folder] = await tx
        .update(folders)
        .set({ isDeleted: true })
        .where(
          and(
            eq(folders.userId, userData.user.id),
            eq(folders.id, id),
            eq(folders.isDeleted, false),
          ),
        )
        .returning();
      if (!folder)
        throw new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND);

      return res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successDeleteFolder, data: folder });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const restoreFolder = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.body;
    if (!id)
      throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id));
      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [folder] = await tx
        .update(folders)
        .set({ isDeleted: false })
        .where(
          and(
            eq(folders.id, id),
            eq(folders.userId, profile.id),
            eq(folders.isDeleted, true),
          ),
        );
      if (!folder)
        throw new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND);

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successRestoreFolder, data: folder });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleCustomError") {
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
      throw new CustomError(errors.folderIdMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [folder] = await tx
        .update(folders)
        .set({ isFavourite: true })
        .where(
          and(
            eq(folders.id, id),
            eq(folders.userId, profile.id),
            eq(folders.isFavourite, false),
          ),
        )
        .returning();

      if (!folder) throw new CustomError(errors.folderNotFound, 404);

      res
        .status(HttpStatusCode.OK)
        .json({ message: successMessages.successAddFavourite, data: folder });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleCustomError") {
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
      throw new CustomError(errors.folderIdMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [folder] = await tx
        .update(folders)
        .set({ isFavourite: false })
        .where(
          and(
            eq(folders.id, id),
            eq(folders.userId, profile.id),
            eq(folders.isFavourite, true),
          ),
        )
        .returning();

      if (!folder) throw new CustomError(errors.folderNotFound, 404);

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successRemoveFavourite,
        data: folder,
      });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleCustomError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const getFavouriteFolders = async (
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
        .where(eq(profiles.id, userData.user.id));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const folder = await tx
        .select()
        .from(folders)
        .where(
          and(eq(folders.userId, profile.id), eq(folders.isFavourite, true)),
        );

      res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveFolders,
        data: folder,
      });
    });
  } catch (e: any) {
    if (e.constructor.name === "DrizzleCustomError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};

export const getDeletedFolders = async (
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
        .from(folders)
        .where(
          and(
            eq(folders.userId, userData.user.id),
            eq(folders.isDeleted, true),
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
