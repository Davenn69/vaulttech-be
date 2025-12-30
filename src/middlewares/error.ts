import { NextFunction, Request, Response } from "express";
import CustomError from "../models/errorCustom";

export default function errorHandler(err: CustomError, req: Request, res: Response, next: NextFunction) {
    if (err.status) {
        return res.status(err.status).json({ message: err.message })
    }

    return res.status(500).json({ message: err.message })
}