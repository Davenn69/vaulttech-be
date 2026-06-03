import { Request, Response, NextFunction } from "express";
import CustomError from "../types/errorCustom";
import { successMessages } from "../utils/successMessages";
import { db } from "../db";
import { validateToken } from "../middlewares/protected";
import { profiles } from "../models/profiles";
import { and, eq, ilike, ne, SQL } from "drizzle-orm";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import { files } from "../models/files";
import { folders } from "../models/folders";

type RecentItemType = "file" | "folder";

type RecentItem = {
  itemType: RecentItemType;
  id: string;
  createdAt: string;
  updatedAt: string | null;
  name: string;
  createdBy: string;
  updatedBy: string | null;
  userId: string;
  isFavourite: boolean;
  isDeleted: boolean;
};

type RecentGroupedByDate = Record<
  string,
  {
    file: RecentItem[];
    folder: RecentItem[];
  }
>;

const getDateKey = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

export const getRecent = async (
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
        .where(and(eq(profiles.id, userData.user.id)))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const folderConditions = [
        eq(folders.userId, profile.id),
        eq(folders.isDeleted, false),
      ];

      if (profile.homeFolderId) {
        folderConditions.push(ne(folders.id, profile.homeFolderId));
      }

      const [folderData, fileData] = await Promise.all([
        tx
          .select()
          .from(folders)
          .where(and(...folderConditions)),
        tx
          .select()
          .from(files)
          .where(and(eq(files.userId, profile.id), eq(files.isDeleted, false))),
      ]);

      const recentItems: RecentItem[] = [
        ...folderData.map((item) => ({
          ...item,
          itemType: "folder" as const,
        })),
        ...fileData.map((item) => ({
          ...item,
          itemType: "file" as const,
        })),
      ].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      const groupedByDate = recentItems.reduce<RecentGroupedByDate>(
        (acc, item) => {
          const dateKey = getDateKey(item.createdAt);

          if (!acc[dateKey]) {
            acc[dateKey] = { file: [], folder: [] };
          }

          acc[dateKey][item.itemType].push(item);
          return acc;
        },
        {},
      );

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successGetRecent,
        data: groupedByDate,
      });
    });
  } catch (e) {
    next(e);
  }
};

export const searchData = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { keyword } = req.query as { keyword?: string };

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const fileConditions: SQL[] = [
        eq(files.userId, profile.id),
        eq(files.isDeleted, false),
      ];

      const folderConditions: SQL[] = [
        eq(folders.userId, profile.id),
        eq(folders.isDeleted, false),
      ];

      if (keyword) {
        fileConditions.push(ilike(files.name, `%${keyword}%`));
        folderConditions.push(ilike(folders.name, `%${keyword}%`));
      }

      const [folderData, fileData] = await Promise.all([
        tx
          .select()
          .from(folders)
          .where(and(...folderConditions)),
        tx
          .select()
          .from(files)
          .where(and(...fileConditions)),
      ]);

      const items: RecentItem[] = [
        ...folderData.map((item) => ({
          ...item,
          itemType: "folder" as const,
        })),
        ...fileData.map((item) => ({
          ...item,
          itemType: "file" as const,
        })),
      ].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successGetRecent,
        data: items,
      });
    });
  } catch (e) {
    next(e);
  }
};
