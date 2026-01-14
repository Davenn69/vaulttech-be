import { Request, Response, NextFunction } from "express";
import CustomError from "../models/errorCustom";
import { errors } from "../utils/errorMessages";
import path from "path";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";
import { v4 as uuidv4 } from "uuid"
import { db } from "..";
import { profiles } from "../models/profiles";
import { eq, and } from "drizzle-orm";
import { files } from "../models/files";
import { DrizzleErrorCode } from "../models/drizzleError";

export const uploadFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { folderId } = req.body
        if (!req.file) return next(new CustomError(errors.fileMissing, 400))

        if (!folderId) return next(new CustomError(errors.folderIdMissing, 400))

        const { data: data, error: error } = await supabase.auth.getUser()
        if (error) return next(new CustomError(errors.invalidUser, 400))

        await db.transaction(async (tx) => {
            const [profile] = await tx.select().from(profiles).where(eq(profiles.id, data.user.id)).limit(1)

            if (!profile) return next(new CustomError(errors.invalidUser, 400))

            const file = req.file!;
            const fileExt = path.extname(file.originalname).replaceAll('.', '')
            const fileSize = file.size
            const fileName = file.originalname.split('.')[0]!
            const uniqueName = `${uuidv4()}.${fileExt}`
            const filePath = `${profile.id}/${folderId}/${uniqueName}`

            const { error: error } = await supabase.storage.from('Documents').upload(filePath, file.buffer, {
                contentType: file.mimetype,
                cacheControl: '3600'
            })

            if (error) return next(new CustomError(error.message, 400))

            const [fileData] = await tx.insert(files).values({ userId: profile.id, extension: fileExt, name: fileName, createdBy: profile.username, size: fileSize, path: filePath, folderId: folderId }).returning()

            if (!fileData) return next(new CustomError(errors.uploadFileFailed, 400))

            res.status(201).json({ message: successMessages.successUpload, data: fileData })
        })
    } catch (e: any) {
        if (e.constructor.name === 'DrizzleQueryError') {
            next(new DrizzleErrorCode(e.cause.code))
        } else {
            next(new CustomError(e.message, 500))
        }
    }
}

export const selectFiles = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params

        if (!id) return next(new CustomError(errors.folderIdMissing, 400))

        const { data: data, error: error } = await supabase.auth.getUser()
        if (error) return next(new CustomError(errors.invalidUser, 400))

        await db.transaction(async (tx) => {
            const [profile] = await tx.select().from(profiles).where(eq(profiles.id, data.user.id)).limit(1)

            if (!profile) return next(new CustomError(errors.invalidUser, 400))

            const file = await tx.select().from(files).where(and(eq(files.folderId, id), eq(files.userId, data.user.id)))

            res.status(200).json({ message: successMessages.successRetrieveFiles, data: file })
        })

    } catch (e: any) {
        if (e.constructor.name === 'DrizzleQueryError') {
            next(new DrizzleErrorCode(e.cause.code))
        } else {
            next(new CustomError(e.message, 500))
        }
    }
}

export const updateName = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id, name } = req.body

        if (!id) return next(new CustomError(errors.idMissing, 400))
        if (!name) return next(new CustomError(errors.nameMissing, 400))

        const { data: data, error: error } = await supabase.auth.getUser()
        if (error) return next(new CustomError(errors.invalidUser, 400))

        await db.transaction(async (tx) => {
            const [profile] = await tx.select().from(profiles).where(eq(profiles.id, data.user.id)).limit(1)

            if (!profile) return next(new CustomError(errors.invalidUser, 400))

            const [file] = await tx.update(files).set({ name: name }).where(and(eq(files.id, id), eq(files.userId, data.user.id))).returning()

            if (!file) return next(new CustomError(errors.fileNotFound, 400))

            res.status(201).json({ message: successMessages.successUpdateFile, data: file })
        })
    } catch (e: any) {
        if (e.constructor.name === 'DrizzleQueryError') {
            return next(new DrizzleErrorCode(e.cause.code))
        }

        return next(new CustomError(e.message, 500))
    }
}

export const deleteFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params

        if (!id) return next(new CustomError(errors.idMissing, 400))

        const { data: data, error: error } = await supabase.auth.getUser()
        if (error) return next(new CustomError(errors.invalidUser, 400))

        await db.transaction(async (tx) => {
            const [profile] = await tx.select().from(profiles).where(eq(profiles.id, data.user.id)).limit(1)

            if (!profile) return next(new CustomError(errors.invalidUser, 400))

            const [file] = await tx.delete(files).where(and(eq(files.id, id), eq(files.userId, data.user.id))).returning()

            if (!file) return next(new CustomError(errors.fileNotFound, 400))

            res.status(200).json({ message: successMessages.successDeleteFile, data: file })
        })
    } catch (e: any) {
        if (e.constructor.name === 'DrizzleQueryError') {
            next(new DrizzleErrorCode(e.cause.code))
        } else {
            next(new CustomError(e.message, 500))
        }
    }
}

export const moveFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { oldId, newId } = req.body

        const { data: data, error: error } = await supabase.auth.getUser()
        if (error) return next(new CustomError(errors.invalidUser, 400))

        await db.transaction(async (tx) => {
            const [profile] = await tx.select().from(profiles).where(eq(profiles.id, data.user.id)).limit(1)

            if (!profile) return next(new CustomError(errors.invalidUser, 400))

            const [file] = await tx.update(files).set({ folderId: newId }).where(and(eq(files.folderId, oldId), eq(files.userId, data.user.id))).returning()

            if (!file) return next(new CustomError(errors.folderNotFound, 404))

            res.status(201).json({ message: successMessages.successMoveFile, data: file })
        })
    } catch (e: any) {
        if (e.constructor.name === 'DrizzleQueryError') {
            next(new DrizzleErrorCode(e.cause.code))
        } else {
            next(new CustomError(e.message, 500))
        }
    }
}