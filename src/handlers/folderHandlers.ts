import { Request, Response, NextFunction } from "express";
import CustomError from "../models/errorCustom";
import { errors } from "../utils/errorMessages";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";

export const createFolder = async (req: Request, res: Response, next: NextFunction) => {
    const { parentId, name } = req.body

    if (!parentId) return next(new CustomError(errors.folderIdMissing))

    if (!name) return next(new CustomError(errors.nameMissing))

    const { data: profile, error: profileError } = await supabase.from('profiles').select().single()
    if (profileError) return next(new CustomError(errors.invalidUser, 400))

    const { data: parentFolder, error: parentError } = await supabase.from('folders').select().eq("id", parentId).single()
    if (parentError) return next(new CustomError(parentError.message, 400))

    const { data: folder, error: folderError } = await supabase.from("folders").insert({ user_id: profile.id, name: name, created_by: profile.username, path: parentFolder.path, parent_id: parentFolder.id }).select()
    if (folderError) return next(new CustomError(folderError.message, 400))

    res.status(201).json({ message: successMessages.successCreateFolder, data: folder[0] })
}

export const getFolders = async (req: Request, res: Response, next: NextFunction) => {
    const { parentId } = req.params

    if (!parentId) return next(new CustomError(errors.folderIdMissing))

    const { data: profile, error: profileError } = await supabase.from('profiles').select().single()
    if (profileError) return next(new CustomError(errors.invalidUser, 400))

    const { data: folder, error: error } = await supabase.from('folders').select().eq("parent_id", parentId)
    if (error) return next(new CustomError(error.message, 400))

    res.status(200).json({ message: successMessages.successRetrieveFolders, data: folder })
}