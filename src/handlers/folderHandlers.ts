import { Request, Response, NextFunction } from "express";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";
import { db } from "..";
import { profiles } from "../models/profiles";
import { and, eq } from "drizzle-orm";
import { folders } from "../models/folders";
import { DrizzleErrorCode } from "../types/drizzleError";
import { HttpStatusCode } from "../types/httpStatusCode";
import { error } from "console";

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

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError)
      throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id));

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const [parentFolder] = await tx
        .select()
        .from(folders)
        .where(eq(folders.id, parentId));
      if (!parentFolder)
        return next(
          new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND),
        );

      const [folder] = await tx
        .insert(folders)
        .values({
          userId: profile.id,
          name: name,
          createdBy: profile.username,
          path: parentFolder.path,
          parentId: parentFolder.id,
        })
        .returning();

      res
        .status(HttpStatusCode.CREATED)
        .json({ message: successMessages.successCreateFolder, data: folder });
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

    if (!parentId)
      throw new CustomError(errors.folderIdMissing, HttpStatusCode.BAD_REQUEST);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError)
      throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

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
        .where(eq(folders.parentId, parentId));
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

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError)
      throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

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

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError)
      throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

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

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError)
      return next(
        new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST),
      );

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

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError)
      throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

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
