import { Request, Response, NextFunction } from "express";
import CustomError from "../models/errorCustom";
import { errors } from "../utils/errorMessages";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";
import { db } from "..";
import { profiles } from "../models/profiles";
import { and, eq } from "drizzle-orm";
import { folders } from "../models/folders";
import { DrizzleErrorCode } from "../models/drizzleError";

export const createFolder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { parentId, name } = req.body

        if (!parentId) return next(new CustomError(errors.folderIdMissing))

        if (!name) return next(new CustomError(errors.nameMissing))

        const { data: data, error: error } = await supabase.auth.getUser()
        if (error) return next(new CustomError(errors.invalidUser, 400))

        await db.transaction(async (tx) => {
            const [profile] = await tx.select().from(profiles).where(eq(profiles.id, data.user.id))

            if (!profile) return next(new CustomError(errors.invalidUser, 400))

            const [parentFolder] = await tx.select().from(folders).where(eq(folders.id, parentId))
            if (!parentFolder) return next(new CustomError(errors.folderNotFound, 400))

            const [folder] = await tx.insert(folders).values({ userId: profile.id, name: name, createdBy: profile.username, path: parentFolder.path, parentId: parentFolder.id }).returning()

            res.status(201).json({ message: successMessages.successCreateFolder, data: folder })
        })
    } catch (e: any) {
        if (e.constructor.name === 'DrizzleQueryError') {
            next(new DrizzleErrorCode(e.cause.code))
        } else {
            next(new CustomError(e.message, 500))
        }
    }
}

export const getFolders = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { parentId } = req.params

        if (!parentId) return next(new CustomError(errors.folderIdMissing, 400))

        const { data: data, error: error } = await supabase.auth.getUser()
        if (error) return next(new CustomError(errors.invalidUser, 400))

        await db.transaction(async (tx) => {
            const [profile] = await tx.select().from(profiles).where(eq(profiles.id, data.user.id))

            if (!profile) return next(new CustomError(errors.invalidUser, 400))

            const folder = await tx.select().from(folders).where(eq(folders.parentId, parentId))
            if (!folder) return next(new CustomError(errors.folderNotFound, 400))

            res.status(200).json({ message: successMessages.successRetrieveFolders, data: folder })
        })
    } catch (e: any) {
        if (e.constructor.name === 'DrizzleQueryError') {
            next(new DrizzleErrorCode(e.cause.code))
        } else {
            next(new CustomError(e.message, 500))
        }
    }
}

export const updateFolder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id, name } = req.body

        if (!id) return next(new CustomError(errors.folderIdMissing, 400))

        if (!name) return next(new CustomError(errors.nameMissing, 400))

        const { data: data, error: error } = await supabase.auth.getUser()
        if (error) return next(new CustomError(errors.invalidUser, 400))

        await db.transaction(async (tx) => {
            const [profile] = await tx.select().from(profiles).where(eq(profiles.id, data.user.id))

            if (!profile) return next(new CustomError(errors.invalidUser, 400))

            const [folder] = await tx.update(folders).set({ name: name }).where(and(eq(folders.userId, data.user.id), eq(folders.id, id))).returning()

            if (!folder) return next(new CustomError(errors.folderNotFound, 404))

            res.status(201).json({ message: successMessages.successUpdateFolder, data: folder })
        })
    } catch (e: any) {
        if (e.constructor.name === 'DrizzleQueryError') {
            next(new DrizzleErrorCode(e.cause.code))
        } else {
            next(new CustomError(e.message, 500))
        }
    }
}

export const deleteFolder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params

        if (!id) return next(new CustomError(errors.folderIdMissing, 400))

        const { data: data, error: error } = await supabase.auth.getUser()
        if (error) return next(new CustomError(errors.invalidUser, 400))

        await db.transaction(async (tx) => {
            const [profile] = await tx.select().from(profiles).where(eq(profiles.id, data.user.id))

            if (!profile) return next(new CustomError(errors.invalidUser, 400))

            const [folder] = await tx.update(folders).set({ isDeleted: true }).where(and(eq(folders.userId, data.user.id), eq(folders.id, id), eq(folders.isDeleted, false))).returning()
            if (!folder) return next(new CustomError(errors.folderNotFound, 404))

            return res.status(201).json({ message: successMessages.successDeleteFolder, data: folder })
        })
    } catch (e: any) {
        if (e.constructor.name === 'DrizzleQueryError') {
            next(new DrizzleErrorCode(e.cause.code))
        } else {
            next(new CustomError(e.message, 500))
        }
    }
}