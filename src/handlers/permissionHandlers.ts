import { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import { validateToken } from "../middlewares/protected";
import { DrizzleErrorCode } from "../types/drizzleError";
import { successMessages } from "../utils/successMessages";
import { profiles } from "../models/profiles";
import { files } from "../models/files";
import { folders } from "../models/folders";
import { authUsers } from "../models/auth";
import { filePermissions } from "../models/file_permissions";
import { folderPermissions } from "../models/folder_permissions";

const PERMISSION_RESOURCE = {
  file: "file",
  folder: "folder",
} as const;

export const createPermission = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { fileId, folderId, grantedTo, permissionType } = req.body as {
      fileId?: string;
      folderId?: string;
      grantedTo?: string;
      permissionType?: string;
    };

    if (!grantedTo) {
      throw new CustomError(errors.grantedToMissing, HttpStatusCode.BAD_REQUEST);
    }

    if (!permissionType) {
      throw new CustomError(
        errors.permissionTypeMissing,
        HttpStatusCode.BAD_REQUEST,
      );
    }

    if (!fileId && !folderId) {
      throw new CustomError(
        errors.permissionResourceMissing,
        HttpStatusCode.BAD_REQUEST,
      );
    }

    if (fileId && folderId) {
      throw new CustomError(
        errors.permissionResourceMissing,
        HttpStatusCode.BAD_REQUEST,
      );
    }

    const userData = await validateToken(req.headers.authorization);

    const permission = await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile) {
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);
      }

      const [targetUser] = await tx
        .select()
        .from(authUsers)
        .where(eq(authUsers.id, grantedTo))
        .limit(1);

      if (!targetUser) {
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);
      }

      if (fileId) {
        const [file] = await tx
          .select()
          .from(files)
          .where(and(eq(files.id, fileId), eq(files.userId, profile.id)))
          .limit(1);

        if (!file) {
          throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);
        }

        const [existingPermission] = await tx
          .select()
          .from(filePermissions)
          .where(
            and(
              eq(filePermissions.fileId, fileId),
              eq(filePermissions.grantedTo, grantedTo),
              eq(filePermissions.permissionType, permissionType),
            ),
          )
          .limit(1);

        if (existingPermission) {
          const [updatedPermission] = await tx
            .update(filePermissions)
            .set({
              permissionType,
              isActive: true,
              grantedBy: profile.id,
            })
            .where(eq(filePermissions.id, existingPermission.id))
            .returning();

          if (!updatedPermission) {
            throw new CustomError(
              errors.permissionNotCreated,
              HttpStatusCode.BAD_REQUEST,
            );
          }

          return {
            resource: PERMISSION_RESOURCE.file,
            permission: updatedPermission,
            action: "updated",
          };
        }

        const [createdPermission] = await tx
          .insert(filePermissions)
          .values({
            fileId,
            grantedTo,
            grantedBy: profile.id,
            permissionType,
            isActive: true,
          })
          .returning();

        if (!createdPermission) {
          throw new CustomError(
            errors.permissionNotCreated,
            HttpStatusCode.BAD_REQUEST,
          );
        }

        return {
          resource: PERMISSION_RESOURCE.file,
          permission: createdPermission,
          action: "created",
        };
      }

      const [folder] = await tx
        .select()
        .from(folders)
        .where(and(eq(folders.id, folderId!), eq(folders.userId, profile.id)))
        .limit(1);

      if (!folder) {
        throw new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND);
      }

      const [existingPermission] = await tx
        .select()
        .from(folderPermissions)
        .where(
          and(
            eq(folderPermissions.folderId, folderId!),
            eq(folderPermissions.grantedTo, grantedTo),
            eq(folderPermissions.permissionType, permissionType),
          ),
        )
        .limit(1);

      if (existingPermission) {
        const [updatedPermission] = await tx
          .update(folderPermissions)
          .set({
            permissionType,
            isActive: true,
            grantedBy: profile.id,
          })
          .where(eq(folderPermissions.id, existingPermission.id))
          .returning();

        if (!updatedPermission) {
          throw new CustomError(
            errors.permissionNotCreated,
            HttpStatusCode.BAD_REQUEST,
          );
        }

        return {
          resource: PERMISSION_RESOURCE.folder,
          permission: updatedPermission,
          action: "updated",
        };
      }

      const [createdPermission] = await tx
        .insert(folderPermissions)
        .values({
          folderId: folderId!,
          grantedTo,
          grantedBy: profile.id,
          permissionType,
          isActive: true,
        })
        .returning();

      if (!createdPermission) {
        throw new CustomError(
          errors.permissionNotCreated,
          HttpStatusCode.BAD_REQUEST,
        );
      }

      return {
        resource: PERMISSION_RESOURCE.folder,
        permission: createdPermission,
        action: "created",
      };
    });

    return res
      .status(permission.action === "updated" ? HttpStatusCode.OK : HttpStatusCode.CREATED)
      .json({
        message: successMessages.successCreatePermission,
        data: permission,
      });
  } catch (e: any) {
    if (e.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode(e.cause.code));
    } else {
      next(e);
    }
  }
};
