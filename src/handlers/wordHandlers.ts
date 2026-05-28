import { Request, Response, NextFunction } from "express";
import { validateToken } from "../middlewares/protected";
import { db } from "..";
import { profiles } from "../models/profiles";
import { and, desc, eq } from "drizzle-orm";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import { supabase } from "../utils/supabase";
import { v4 as uuidv4 } from "uuid";
import { successMessages } from "../utils/successMessages";
import { files } from "../models/files";
import { fileRevisions } from "../models/file_revisions";
import { DrizzleErrorCode } from "../types/drizzleError";
import { createHash } from "crypto";
import {
  createEmptyTiptapDocument,
  ensureWordCollaborationDocument,
  loadWordCollaborationSnapshot,
  loadWordDocumentFromStorage,
  normalizeWordContent,
  resolveWordFileAccess,
  saveWordCollaborationEvent,
  upsertWordCollaborationSession,
} from "../services/wordCollaboration";
import {
  convertWordDocumentXmlToTiptap,
  createBlankWordDocument,
  createWordDocumentFromTiptap,
  extractWordDocumentParts,
} from "../utils/wordUtils";

const buildFileHash = (buffer: Buffer) => {
  return createHash("sha256").update(buffer).digest("hex");
};

const parseWordContent = (content: unknown) => {
  return normalizeWordContent(content);
};

export const createWordFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { folderId } = req.body;

    if (!folderId)
      throw new CustomError(errors.folderIdMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      if (!profile.homeFolderId)
        throw new CustomError(errors.folderNotFound, HttpStatusCode.NOT_FOUND);

      const documentBuffer = createBlankWordDocument();
      const fileName = "Untitled";
      const fileExt = "docx";
      const uniqueName = `${uuidv4()}.${fileExt}`;
      const filePath = `${profile.id}/${folderId}/${uniqueName}`;
      const fileHash = buildFileHash(documentBuffer);

      const { error: bucketError } = await supabase.storage
        .from("Documents")
        .upload(filePath, documentBuffer, {
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          cacheControl: "3600",
          upsert: false,
        });

      console.log(filePath);
      console.log(bucketError);

      if (bucketError)
        throw new CustomError(bucketError.message, HttpStatusCode.BAD_REQUEST);

      try {
        const [fileData] = await tx
          .insert(files)
          .values({
            userId: profile.id,
            folderId,
            name: fileName,
            createdBy: profile.username,
            extension: fileExt,
            size: documentBuffer.length,
            path: filePath,
          })
          .returning();

        if (!fileData)
          throw new CustomError(
            errors.uploadFileFailed,
            HttpStatusCode.BAD_REQUEST,
          );

        const [revisionData] = await tx
          .insert(fileRevisions)
          .values({
            fileId: fileData.id,
            versionNumber: 1,
            storageKey: filePath,
            fileHash,
            size: documentBuffer.length,
          })
          .returning();

          if (!revisionData)
          throw new CustomError(
            errors.uploadFileFailed,
            HttpStatusCode.BAD_REQUEST,
          );

        const collaborationDocument = await ensureWordCollaborationDocument(
          tx,
          fileData.id,
          createEmptyTiptapDocument(),
          profile.id,
          1,
        );

        return res.status(HttpStatusCode.CREATED).json({
          message: successMessages.successCreateWordFile,
          data: fileData,
          collaboration: collaborationDocument,
        });
      } catch (error) {
        try {
          await supabase.storage.from("Documents").remove([filePath]);
        } catch {
          // Best effort cleanup only.
        }
        throw error;
      }
    });
  } catch (e: any) {
    if ((e as any)?.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode((e as any).cause.code));
    } else {
      next(e);
    }
  }
};

export const getWordFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const { file } = await resolveWordFileAccess(tx, id, profile.id, "read");

      const { data: bucketFile, error: bucketError } = await supabase.storage
        .from("Documents")
        .download(file.path);

      console.log(bucketError);
      console.log(bucketFile);
      console.log(file.path);

      if (bucketError || !bucketFile)
        throw new CustomError(
          errors.downloadFileFailed,
          HttpStatusCode.BAD_REQUEST,
        );

      const buffer = Buffer.from(await bucketFile.arrayBuffer());
      const { documentXml, numberingXml } = extractWordDocumentParts(buffer);
      const tiptapContent = convertWordDocumentXmlToTiptap(
        documentXml,
        numberingXml,
      );

      const existingCollaborationState = await loadWordCollaborationSnapshot(
        tx,
        file.id,
      );

      const collaborationDocument = existingCollaborationState
        ? existingCollaborationState
        : {
            document: normalizeWordContent(tiptapContent),
            versionNumber: 1,
          };

      if (!existingCollaborationState) {
        await ensureWordCollaborationDocument(
          tx,
          file.id,
          collaborationDocument.document,
          profile.id,
          collaborationDocument.versionNumber,
        );
      }

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveWordFile,
        data: {
          file,
          content: collaborationDocument.document,
          collaboration: {
            document: collaborationDocument.document,
            versionNumber: collaborationDocument.versionNumber,
          },
        },
      });
    });
  } catch (e) {
    if ((e as any)?.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode((e as any).cause.code));
    } else {
      next(e);
    }
  }
};

export const save = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, content } = req.body;

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);
    if (content === undefined || content === null || content === "")
      throw new CustomError(errors.missingBody, HttpStatusCode.BAD_REQUEST);

    const parsedContent = parseWordContent(content);
    const documentBuffer = createWordDocumentFromTiptap(parsedContent);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const { file } = await resolveWordFileAccess(tx, id, profile.id, "write");

      const [latestRevision] = await tx
        .select({
          versionNumber: fileRevisions.versionNumber,
        })
        .from(fileRevisions)
        .where(eq(fileRevisions.fileId, file.id))
        .orderBy(desc(fileRevisions.versionNumber))
        .limit(1);

      const nextVersion = Number(latestRevision?.versionNumber ?? 0) + 1;
      const storageKey = `${profile.id}/${file.folderId}/${file.id}/revisions/${uuidv4()}.docx`;
      const fileHash = buildFileHash(documentBuffer);

      const { error: bucketError } = await supabase.storage
        .from("Documents")
        .upload(storageKey, documentBuffer, {
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          cacheControl: "3600",
          upsert: false,
        });

      if (bucketError)
        throw new CustomError(bucketError.message, HttpStatusCode.BAD_REQUEST);

      try {
        const [updatedFile] = await tx
          .update(files)
          .set({
            path: storageKey,
            size: documentBuffer.length,
            updatedAt: new Date().toISOString(),
            updatedBy: profile.username,
          })
          .where(and(eq(files.id, file.id), eq(files.userId, profile.id)))
          .returning();

        if (!updatedFile)
          throw new CustomError(
            errors.uploadFileFailed,
            HttpStatusCode.BAD_REQUEST,
          );

        const [revisionData] = await tx
          .insert(fileRevisions)
          .values({
            fileId: file.id,
            versionNumber: nextVersion,
            storageKey,
            fileHash,
            size: documentBuffer.length,
          })
          .returning();

        if (!revisionData)
          throw new CustomError(
            errors.uploadFileFailed,
            HttpStatusCode.BAD_REQUEST,
          );

        const collaborationDocument = await ensureWordCollaborationDocument(
          tx,
          file.id,
          normalizeWordContent(parsedContent),
          profile.id,
          nextVersion,
        );

        await saveWordCollaborationEvent(
          tx,
          file.id,
          profile.id,
          "snapshot",
          {
            versionNumber: nextVersion,
            storageKey,
            collaborationDocumentId: collaborationDocument.id,
          },
        );

        return res.status(HttpStatusCode.OK).json({
          message: successMessages.successSaveWordFile,
          data: {
            file: updatedFile,
            revision: revisionData,
            collaboration: {
              versionNumber: nextVersion,
            },
          },
        });
      } catch (error) {
        try {
          await supabase.storage.from("Documents").remove([storageKey]);
        } catch {
          // Best effort cleanup only.
        }
        throw error;
      }
    });
  } catch (e) {
    if ((e as any)?.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode((e as any).cause.code));
    } else {
      next(e);
    }
  }
};

export const getWordCollaboration = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const { file } = await resolveWordFileAccess(tx, id, profile.id, "read");

      const snapshot = await loadWordCollaborationSnapshot(tx, file.id);

      if (!snapshot) {
        const document = await loadWordDocumentFromStorage(file.path);
        const collaborationDocument = await ensureWordCollaborationDocument(
          tx,
          file.id,
          document,
          profile.id,
          1,
        );

        return res.status(HttpStatusCode.OK).json({
          message: successMessages.successRetrieveWordCollaboration,
          data: {
            file,
            collaboration: {
              document: normalizeWordContent(collaborationDocument.state),
              versionNumber: collaborationDocument.versionNumber,
            },
          },
        });
      }

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successRetrieveWordCollaboration,
        data: {
          file,
          collaboration: snapshot,
        },
      });
    });
  } catch (e) {
    if ((e as any)?.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode((e as any).cause.code));
    } else {
      next(e);
    }
  }
};

export const joinWordCollaboration = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    const { connectionId, cursorState, selectionState } = req.body as {
      connectionId?: string;
      cursorState?: unknown;
      selectionState?: unknown;
    };

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);

    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const { file } = await resolveWordFileAccess(tx, id, profile.id, "read");
      const snapshot = await loadWordCollaborationSnapshot(tx, file.id);

      if (!snapshot) {
        const document = await loadWordDocumentFromStorage(file.path);
        await ensureWordCollaborationDocument(tx, file.id, document, profile.id);
      }

      const session = await upsertWordCollaborationSession(tx, {
        fileId: file.id,
        userId: profile.id,
        connectionId: connectionId ?? uuidv4(),
        cursorState,
        selectionState,
      });

      const latestSnapshot =
        snapshot ?? (await loadWordCollaborationSnapshot(tx, file.id));

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successJoinWordCollaboration,
        data: {
          file,
          session,
          collaboration: latestSnapshot,
        },
      });
    });
  } catch (e) {
    if ((e as any)?.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode((e as any).cause.code));
    } else {
      next(e);
    }
  }
};

export const syncWordCollaboration = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    const { content, versionNumber } = req.body as {
      content?: unknown;
      versionNumber?: number;
    };

    if (!id)
      throw new CustomError(errors.idMissing, HttpStatusCode.BAD_REQUEST);
    if (content === undefined || content === null || content === "")
      throw new CustomError(errors.missingBody, HttpStatusCode.BAD_REQUEST);

    const parsedContent = normalizeWordContent(content);
    const userData = await validateToken(req.headers.authorization);

    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userData.user.id))
        .limit(1);

      if (!profile)
        throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);

      const { file } = await resolveWordFileAccess(tx, id, profile.id, "write");
      const collaborationDocument = await ensureWordCollaborationDocument(
        tx,
        file.id,
        parsedContent,
        profile.id,
        versionNumber ?? undefined,
      );

      await saveWordCollaborationEvent(
        tx,
        file.id,
        profile.id,
        "sync",
        {
          versionNumber: collaborationDocument.versionNumber,
        },
      );

      return res.status(HttpStatusCode.OK).json({
        message: successMessages.successSyncWordCollaboration,
        data: {
          file,
          collaboration: {
            document: normalizeWordContent(collaborationDocument.state),
            versionNumber: collaborationDocument.versionNumber,
          },
        },
      });
    });
  } catch (e) {
    if ((e as any)?.constructor?.name === "DrizzleQueryError") {
      next(new DrizzleErrorCode((e as any).cause.code));
    } else {
      next(e);
    }
  }
};
