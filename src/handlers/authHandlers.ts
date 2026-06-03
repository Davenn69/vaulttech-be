import { NextFunction, Request, Response } from "express";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";
import { validation } from "../utils/validation";
import { db } from "../db";
import { profiles } from "../models/profiles";
import { folders } from "../models/folders";
import { HttpStatusCode } from "../types/httpStatusCode";
import { eq } from "drizzle-orm";

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.body)
      throw new CustomError(errors.missingBody, HttpStatusCode.BAD_REQUEST);
    const { email, password, username } = req.body;

    const emailMessage = validation.validateEmail(email);
    if (emailMessage)
      throw new CustomError(emailMessage, HttpStatusCode.BAD_REQUEST);

    const passwordMessage = validation.validatePassword(password);
    if (passwordMessage)
      throw next(new CustomError(passwordMessage, HttpStatusCode.BAD_REQUEST));

    const usernameMessage = validation.validateUsername(username);
    if (usernameMessage)
      throw new CustomError(usernameMessage, HttpStatusCode.BAD_REQUEST);

    await db.transaction(async (tx) => {
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({ email: email, password: password });
      if (signUpError)
        throw new CustomError(signUpError.message, HttpStatusCode.BAD_REQUEST);

      const [folder] = await tx
        .insert(folders)
        .values({
          name: "Home",
          createdBy: username,
          path: "/",
          userId: signUpData.user?.id!,
        })
        .returning();

      if (!folder) throw new CustomError("error creating folder", 400);

      await tx.insert(profiles).values({
        id: signUpData.user?.id!,
        username: username,
        homeFolderId: folder.id,
      });

      return res.status(HttpStatusCode.CREATED).json({
        message: successMessages.register,
        data: { initialFolder: folder.id, ...signUpData },
      });
    });
  } catch (e: any) {
    next(new CustomError(e.message, e.status));
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { email, password } = req.body;

    if (!email)
      throw new CustomError(errors.emailMissing, HttpStatusCode.BAD_REQUEST);

    if (!password)
      throw new CustomError(errors.passwordMissing, HttpStatusCode.BAD_REQUEST);

    const { data: loginData, error: loginError } =
      await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

    if (loginError)
      return next(
        new CustomError(loginError.message, HttpStatusCode.BAD_REQUEST),
      );

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, loginData.user.id));

    return res.status(HttpStatusCode.OK).json({
      message: successMessages.login,
      data: { initialFolder: profile?.homeFolderId, ...loginData },
    });
  } catch (e: any) {
    next(new CustomError(e.message, e.status));
  }
};
