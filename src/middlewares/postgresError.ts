import { NextFunction, Request, Response } from "express";
import { DrizzleErrorCode } from "../models/drizzleError";
import CustomError from "../models/errorCustom";

export const drizzleError = (err: any, req: Request, res: Response, next: NextFunction,) => {

    if (!err.code) {
        return next(err)
    }

    switch (err.code) {
        case '22P02':
            return next(new CustomError('invalid ID format', 400))
        default:
            return next(new CustomError('unhandled exception', 500))
    }
}