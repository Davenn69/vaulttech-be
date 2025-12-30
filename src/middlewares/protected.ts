import { Request, Response, NextFunction } from "express"
import CustomError from "../models/errorCustom"
import { errors } from "../utils/errorMessages"
import { supabase } from "../utils/supabase"

export const protect = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const bearer = req.headers.authorization

        if (!bearer || !bearer.startsWith('Bearer ')) return next(new CustomError(errors.tokenMissing, 400))

        const token = bearer.split(' ')[1]

        if (!token) return next(new CustomError(errors.tokenMissing, 400))
        console.log('is next')
        next()
    } catch (e: any) {
        return next(new CustomError(e.message, 500))
    }
}