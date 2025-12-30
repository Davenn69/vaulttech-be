import { NextFunction, Response, Request } from "express";
import CustomError from "../models/errorCustom";
import { errors } from "../utils/errorMessages";

const requestChecker = (req: Request, res: Response, next: NextFunction) => {
    if (req.method == "POST") {
        if (!req.body) return next(new CustomError(errors.missingBody, 400))
    }
    next()
}