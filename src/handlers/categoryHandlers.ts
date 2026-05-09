import { Request, Response, NextFunction } from "express";
import { db } from "..";
import { categories } from "../models/categories";
import { files } from "../models/files";
import { profiles } from "../models/profiles";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { successMessages } from "../utils/successMessages";
import { and, asc, count, eq } from "drizzle-orm";
import { DrizzleErrorCode } from "../types/drizzleError";
import { HttpStatusCode } from "../types/httpStatusCode";
import { validateToken } from "../middlewares/protected";

export const getCategories = async (
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

      const category = await tx
        .select()
        .from(categories)
        .orderBy(asc(categories.name));

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveCategories,
        data: category,
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

export const createCategory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { name, color } = req.body;

    if (!name)
      throw new CustomError(errors.nameMissing, HttpStatusCode.BAD_REQUEST);
    if (!color)
      throw new CustomError(errors.colorMissing, HttpStatusCode.BAD_REQUEST);

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
        .insert(categories)
        .values({
          name,
          color,
        })
        .returning();

      if (!category)
        throw new CustomError(
          errors.categoryNotCreated,
          HttpStatusCode.BAD_REQUEST,
        );

      return res.status(HttpStatusCode.CREATED).json({
        message: successMessages.successCreateCategory,
        data: category,
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

export const updateCategory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id, name, color } = req.body;

    if (!id)
      throw new CustomError(
        errors.categoryIdMissing,
        HttpStatusCode.BAD_REQUEST,
      );
    if (!name)
      throw new CustomError(errors.nameMissing, HttpStatusCode.BAD_REQUEST);
    if (!color)
      throw new CustomError(errors.colorMissing, HttpStatusCode.BAD_REQUEST);

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
        .update(categories)
        .set({
          name,
          color,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(categories.id, id))
        .returning();

      if (!category)
        throw new CustomError(
          errors.categoryNotFound,
          HttpStatusCode.NOT_FOUND,
        );

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successUpdateCategory,
        data: category,
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

export const deleteCategory = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;

    if (!id)
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

      const fileCount = await tx
        .select({ total: count() })
        .from(files)
        .where(eq(files.categoryId, id));

      if (fileCount[0]!.total > 0)
        throw new CustomError(errors.categoryHasFiles, HttpStatusCode.BAD_REQUEST);

      const [category] = await tx
        .delete(categories)
        .where(eq(categories.id, id))
        .returning();

      if (!category)
        throw new CustomError(
          errors.categoryNotFound,
          HttpStatusCode.NOT_FOUND,
        );

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successDeleteCategory,
        data: category,
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

export const getFilesByCategory = async (
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

      const [categoryData, fileData] = await Promise.all([
        tx.select().from(categories).orderBy(asc(categories.name)),
        tx
          .select()
          .from(files)
          .where(and(eq(files.userId, profile.id), eq(files.isDeleted, false))),
      ]);

      const groupedData = categoryData.reduce<Record<string, typeof fileData>>(
        (acc, category) => {
          acc[category.name] = fileData.filter(
            (file) => file.categoryId === category.id,
          );
          return acc;
        },
        {},
      );

      const uncategorized = fileData.filter((file) => !file.categoryId);
      if (uncategorized.length > 0) {
        groupedData["uncategorized"] = uncategorized;
      }

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveCategories,
        data: groupedData,
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
