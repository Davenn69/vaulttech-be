import { Request, Response, NextFunction } from "express";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { supabase } from "../utils/supabase";
import { AuthError, User } from "@supabase/supabase-js";
import { HttpStatusCode } from "../types/httpStatusCode";

export const protect = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const bearer = req.headers.authorization;

    if (!bearer || !bearer.startsWith("Bearer "))
      return next(new CustomError(errors.tokenMissing, 400));

    const token = bearer.split(" ")[1];

    if (!token) return next(new CustomError(errors.tokenMissing, 400));

    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);

    next();
  } catch (e: any) {
    return next(new CustomError(e.message, 500));
  }
};

export async function validateToken(
  bearer: string | undefined,
): Promise<{ user: User }> {
  const token = bearer?.replace("Bearer ", "");

  const { data: userData, error: userError } =
    await supabase.auth.getUser(token);

  if (userError || !userData.user)
    throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

  return userData;
}
