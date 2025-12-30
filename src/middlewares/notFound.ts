import { NextFunction, Request, Response } from "express";
import { errors } from "../utils/errorMessages";

export const notFound = (req: Request, res: Response, next: NextFunction) => {
    res.status(404).json({ message: errors.notFound })
}