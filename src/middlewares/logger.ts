import { NextFunction, Request, Response } from "express";

export default function logger(req: Request, res: Response, next: NextFunction) {
    console.log(`Request Method ${req.method}`)
    console.log(`Request Body `, req.body)
    console.log(`Request Url ${req.url}`)
    next()
}