import { NextFunction, Request, Response } from "express";
import CustomError from "../models/errorCustom";
import { errors } from "../utils/errorMessages";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";
import { validation } from "../utils/validation";

export const register = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.body) return next(new CustomError(errors.missingBody, 400))
        const { email, password, username } = req.body

        const emailMessage = validation.validateEmail(email)
        if (emailMessage) return next(new CustomError(emailMessage, 400))

        const passwordMessage = validation.validatePassword(password)
        if (passwordMessage) return next(new CustomError(passwordMessage, 400))

        const usernameMessage = validation.validateUsername(username)
        if (usernameMessage) return next(new CustomError(usernameMessage, 400))

        const { data: data, error: error } = await supabase.auth.signUp({ email: email, password: password })
        if (error) return next(new CustomError(error.message, 400))

        const { data: folderData, error: folderError } = await supabase.from('folders').insert({ name: 'Home', created_by: username, path: '/', user_id: data.user?.id }).select()

        if (folderError) return next(new CustomError(folderError.message, 400))

        const { data: profile, error: profileError } = await supabase.from('profiles').insert({ id: data.user?.id, username: username, home_folder_id: folderData[0].id }).select()

        if (profileError) return next(new CustomError(profileError.message, 400))

        return res.status(201).json({ message: successMessages.register, data: data })
    } catch (e: any) {
        next(new CustomError(e.message))
    }
}

export const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.body) return next(new CustomError(errors.missingBody, 400))
        const { email, password } = req.body

        if (!email) return next(new CustomError(errors.emailMissing, 400))
        if (!password) return next(new CustomError(errors.passwordMissing, 400))

        const { data: data, error: error } = await supabase.auth.signInWithPassword({ email: email, password: password })
        if (error) return next(new CustomError(error.message, 400))

        return res.status(200).json({ message: successMessages.login, data: data })
    } catch (e: any) {
        next(new CustomError(e.message))
    }
}