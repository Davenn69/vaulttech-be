import { Request, Response, NextFunction } from "express";
import CustomError from "../models/errorCustom";
import multer from "multer";
import { errors } from "../utils/errorMessages";
import path from "path";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";
import { v4 as uuidv4 } from "uuid"

export const uploadFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { folderId } = req.body
        if (!req.file) return next(new CustomError(errors.fileMissing, 400))

        if (!folderId) return next(new CustomError(errors.folderIdMissing, 400))

        const { data: profile, error: errorProfile } = await supabase.from('profiles').select().single()
        if (errorProfile) return next(new CustomError(errors.invalidUser, 400))

        const file = req.file;
        const fileExt = path.extname(file.originalname).replaceAll('.', '')
        const fileSize = file.size
        const fileName = file.originalname.split('.')[0]
        const uniqueName = `${uuidv4()}${fileExt}`
        const filePath = `${profile.id}/${folderId}/${uniqueName}`

        const { error: error } = await supabase.storage.from('Documents').upload(filePath, file.buffer, {
            contentType: file.mimetype,
            cacheControl: '3600'
        })

        if (error) return next(new CustomError(error.message, 400))

        const { data: fileData, error: fileError } = await supabase.from('files').insert({ user_id: profile.id, extension: fileExt, name: fileName, created_by: profile.username, size: fileSize, path: filePath, folder_id: folderId }).select()

        if (fileError) return next(new CustomError(fileError.message, 400))

        res.status(201).json({ message: successMessages.successUpload, data: fileData[0] })
    } catch (e: any) {
        next(new CustomError(e.message))
    }
}

export const selectFiles = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params

        if (!id) return next(new CustomError(errors.folderIdMissing, 400))

        const { data: profile, error: errorProfile } = await supabase.from('profiles').select().single()
        if (errorProfile) return next(new CustomError(errors.invalidUser, 400))

        const { data: files, error: error } = await supabase.from('files').select().eq('folder_id', id)
        if (error) return next(new CustomError(error.message, 400))

        res.status(200).json({ message: successMessages.successRetrieveFiles, data: files })
    } catch (e: any) {
        next(new CustomError(e.message))
    }
}

export const updateName = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id, name } = req.body

        if (!id) return next(new CustomError(errors.idMissing, 400))

        if (!name) return next(new CustomError(errors.nameMissing, 400))

        const { data: profile, error: errorProfile } = await supabase.from('profiles').select().single()
        if (errorProfile) return next(new CustomError(errors.invalidUser, 400))

        const { data: file, error: error } = await supabase.from('files').update({ name: name }).eq('id', id).select()
        if (error) return next(new CustomError(error.message, 400))

        if (!file || file.length == 0) return next(new CustomError(errors.fileNotFound, 404))

        res.status(201).json({ message: successMessages.successUpdateFile, data: file })
    } catch (e: any) {
        next(new CustomError(e.message))
    }
}