import { NextFunction, Request, Response } from "express";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { supabase } from "../utils/supabase";
import { successMessages } from "../utils/successMessages";
import { validation } from "../utils/validation";
import { db } from "..";
import { profiles } from "../models/profiles";
import { folders } from "../models/folders";

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.body) return next(new CustomError(errors.missingBody, 400));
    const { email, password, username } = req.body;

    const emailMessage = validation.validateEmail(email);
    if (emailMessage) return next(new CustomError(emailMessage, 400));

    const passwordMessage = validation.validatePassword(password);
    if (passwordMessage) return next(new CustomError(passwordMessage, 400));

    const usernameMessage = validation.validateUsername(username);
    if (usernameMessage) return next(new CustomError(usernameMessage, 400));

    await db.transaction(async (tx) => {
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({ email: email, password: password });
      if (signUpError) return next(new CustomError(signUpError.message, 400));

      const [folder] = await tx
        .insert(folders)
        .values({
          name: "Home",
          createdBy: username,
          path: "/",
          userId: signUpData.user?.id!,
        })
        .returning();

      if (!folder) return next(new CustomError("error creating folder", 400));

      await tx.insert(profiles).values({
        id: signUpData.user?.id!,
        username: username,
        homeFolderId: folder.id,
      });

      return res
        .status(201)
        .json({ message: successMessages.register, data: signUpData });
    });
  } catch (e: any) {
    next(new CustomError(e.message, e.status));
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.body) return next(new CustomError(errors.missingBody, 400));
    const { email, password } = req.body;

    if (!email) return next(new CustomError(errors.emailMissing, 400));
    if (!password) return next(new CustomError(errors.passwordMissing, 400));

    const { data: loginData, error: loginError } =
      await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });
    if (loginError) return next(new CustomError(loginError.message, 400));

    return res
      .status(200)
      .json({ message: successMessages.login, data: loginData });
  } catch (e: any) {
    next(new CustomError(e.message));
  }
};
