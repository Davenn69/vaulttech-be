import { Request, Response, NextFunction } from "express";
import CustomError from "../models/errorCustom";
import multer from "multer";
import { errors } from "../utils/errorMessages";
import path from "path";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";
import { User } from "@supabase/supabase-js";

export const uploadFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.file) return next(new CustomError(errors.fileMissing, 400))

        const { data: user, error: errorUser } = await supabase.auth.getUser()

        console.log(user)

        const { data: profile, error: errorProfile } = await supabase.from('profiles').select().single()
        if (errorProfile) return next(new CustomError(errorProfile.message, 400))

        const file = req.file;
        const fileExt = path.extname(file.originalname)
        const fileSize = file.size
        const fileName = file.originalname
        const filePath = `${profile.id}/${fileName}`

        const { data: fileBucket, error: error } = await supabase.storage.from('Documents').upload(filePath, file.buffer, {
            contentType: file.mimetype,
            cacheControl: '3600'
        })

        if (error) return next(new CustomError(error.message, 400))

        const { data: fileData, error: fileError } = await supabase.from('files').insert({ user_id: profile.id, extension: fileExt, name: fileName, created_by: profile.username, size: fileSize, path: '/', folder_id: profile.home_folder_id }).select()

        if (fileError) return next(new CustomError(fileError.message, 400))

        const { data: urlData } = supabase.storage.from('Documents').getPublicUrl(filePath)

        res.status(201).json({ message: successMessages.successUpload, data: urlData })
    } catch (e: any) {
        next(new CustomError(e.message))
    }
}

export const selectFiles = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { folderId } = req.body

        if (!folderId) return next(new CustomError(errors.folderIdMissing, 400))

        const { data: files, error: error } = await supabase.from('files').select().eq('folder_id', folderId)

        if (error) return next(new CustomError(error.message, 400))

        res.status(200).json({ message: successMessages.successRetrieveFiles, data: files })
    } catch (e: any) {
        next(new CustomError(e.message))
    }
}