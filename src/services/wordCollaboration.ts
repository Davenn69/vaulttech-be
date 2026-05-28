import { and, eq } from "drizzle-orm";
import { supabase } from "../utils/supabase";
import { filePermissions } from "../models/file_permissions";
import { files } from "../models/files";
import {
  wordCollaborationDocuments,
  wordCollaborationEvents,
  wordCollaborationSessions,
} from "../models/word_collaboration";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";
import {
  convertWordDocumentXmlToTiptap,
  extractWordDocumentParts,
} from "../utils/wordUtils";

export type TiptapDocument = {
  type: string;
  content: Array<Record<string, unknown>>;
};

export type WordCollaborationSnapshot = {
  document: TiptapDocument;
  versionNumber: number;
};

export const createEmptyTiptapDocument = (): TiptapDocument => {
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
};

export const normalizeWordContent = (content: unknown): TiptapDocument => {
  if (
    content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    (content as TiptapDocument).type === "doc"
  ) {
    const doc = content as TiptapDocument;
    if (Array.isArray(doc.content)) {
      return doc;
    }
  }

  if (Array.isArray(content)) {
    return {
      type: "doc",
      content: content as Array<Record<string, unknown>>,
    };
  }

  if (typeof content === "string") {
    try {
      return normalizeWordContent(JSON.parse(content));
    } catch {
      throw new CustomError(errors.missingBody, HttpStatusCode.BAD_REQUEST);
    }
  }

  return createEmptyTiptapDocument();
};

const EDITABLE_PERMISSION_TYPES = new Set([
  "edit",
  "editor",
  "write",
  "owner",
  "collaborate",
  "collaborator",
]);

export const isEditablePermissionType = (permissionType?: string | null) => {
  if (!permissionType) {
    return false;
  }

  const normalized = permissionType.trim().toLowerCase();
  if (EDITABLE_PERMISSION_TYPES.has(normalized)) {
    return true;
  }

  return normalized.includes("edit") || normalized.includes("write");
};

export const resolveWordFileAccess = async (
  tx: any,
  fileId: string,
  userId: string,
  mode: "read" | "write" = "read",
) => {
  const [file] = await tx
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.isDeleted, false)))
    .limit(1);

  if (!file) {
    throw new CustomError(errors.fileNotFound, HttpStatusCode.NOT_FOUND);
  }

  if (file.userId === userId) {
    return { file, isOwner: true, canEdit: true };
  }

  const [permission] = await tx
    .select()
    .from(filePermissions)
    .where(
      and(
        eq(filePermissions.fileId, fileId),
        eq(filePermissions.grantedTo, userId),
        eq(filePermissions.isActive, true),
      ),
    )
    .limit(1);

  if (!permission) {
    throw new CustomError(errors.fileNotAccessible, HttpStatusCode.FORBIDDEN);
  }

  const canEdit = isEditablePermissionType(permission.permissionType);

  if (mode === "write" && !canEdit) {
    throw new CustomError(errors.fileNotAccessible, HttpStatusCode.FORBIDDEN);
  }

  return { file, permission, isOwner: false, canEdit };
};

export const ensureWordCollaborationDocument = async (
  tx: any,
  fileId: string,
  state: TiptapDocument,
  userId?: string,
  versionNumber?: number,
) => {
  const [existingDocument] = await tx
    .select()
    .from(wordCollaborationDocuments)
    .where(eq(wordCollaborationDocuments.fileId, fileId))
    .limit(1);

  if (existingDocument) {
    const [updatedDocument] = await tx
      .update(wordCollaborationDocuments)
      .set({
        state,
        versionNumber: versionNumber ?? existingDocument.versionNumber,
        updatedAt: new Date().toISOString(),
        updatedBy: userId ?? existingDocument.updatedBy,
      })
      .where(eq(wordCollaborationDocuments.id, existingDocument.id))
      .returning();

    if (!updatedDocument) {
      throw new CustomError(
        errors.uploadFileFailed,
        HttpStatusCode.BAD_REQUEST,
      );
    }

    return updatedDocument;
  }

  const [createdDocument] = await tx
    .insert(wordCollaborationDocuments)
    .values({
      fileId,
      state,
      versionNumber: versionNumber ?? 1,
      updatedBy: userId,
    })
    .returning();

  if (!createdDocument) {
    throw new CustomError(errors.uploadFileFailed, HttpStatusCode.BAD_REQUEST);
  }

  return createdDocument;
};

export const saveWordCollaborationEvent = async (
  tx: any,
  fileId: string,
  createdBy: string,
  eventType: string,
  payload: Record<string, unknown>,
) => {
  const [event] = await tx
    .insert(wordCollaborationEvents)
    .values({
      fileId,
      createdBy,
      eventType,
      payload,
    })
    .returning();

  if (!event) {
    throw new CustomError(errors.uploadFileFailed, HttpStatusCode.BAD_REQUEST);
  }

  return event;
};

export const upsertWordCollaborationSession = async (
  tx: any,
  params: {
    fileId: string;
    userId: string;
    connectionId: string;
    cursorState?: unknown;
    selectionState?: unknown;
  },
) => {
  const [existingSession] = await tx
    .select()
    .from(wordCollaborationSessions)
    .where(
      and(
        eq(wordCollaborationSessions.fileId, params.fileId),
        eq(wordCollaborationSessions.userId, params.userId),
        eq(wordCollaborationSessions.connectionId, params.connectionId),
      ),
    )
    .limit(1);

  if (existingSession) {
    const [updatedSession] = await tx
      .update(wordCollaborationSessions)
      .set({
        cursorState: params.cursorState,
        selectionState: params.selectionState,
        isActive: true,
        lastSeenAt: new Date().toISOString(),
      })
      .where(eq(wordCollaborationSessions.id, existingSession.id))
      .returning();

    if (!updatedSession) {
      throw new CustomError(
        errors.uploadFileFailed,
        HttpStatusCode.BAD_REQUEST,
      );
    }

    return updatedSession;
  }

  const [createdSession] = await tx
    .insert(wordCollaborationSessions)
    .values({
      fileId: params.fileId,
      userId: params.userId,
      connectionId: params.connectionId,
      cursorState: params.cursorState,
      selectionState: params.selectionState,
      isActive: true,
    })
    .returning();

  if (!createdSession) {
    throw new CustomError(errors.uploadFileFailed, HttpStatusCode.BAD_REQUEST);
  }

  return createdSession;
};

export const markWordCollaborationSessionInactive = async (
  tx: any,
  fileId: string,
  userId: string,
  connectionId: string,
) => {
  await tx
    .update(wordCollaborationSessions)
    .set({
      isActive: false,
      lastSeenAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(wordCollaborationSessions.fileId, fileId),
        eq(wordCollaborationSessions.userId, userId),
        eq(wordCollaborationSessions.connectionId, connectionId),
      ),
    );
};

export const loadWordCollaborationSnapshot = async (
  tx: any,
  fileId: string,
) => {
  const [document] = await tx
    .select()
    .from(wordCollaborationDocuments)
    .where(eq(wordCollaborationDocuments.fileId, fileId))
    .limit(1);

  if (!document) {
    return null;
  }

  return {
    document: normalizeWordContent(document.state),
    versionNumber: Number(document.versionNumber ?? 1),
  } satisfies WordCollaborationSnapshot;
};

export const loadWordDocumentFromStorage = async (
  filePath: string,
): Promise<TiptapDocument> => {
  const { data: bucketFile, error: bucketError } = await supabase.storage
    .from("Documents")
    .download(filePath);

  if (bucketError || !bucketFile) {
    throw new CustomError(
      errors.downloadFileFailed,
      HttpStatusCode.BAD_REQUEST,
    );
  }

  const buffer = Buffer.from(await bucketFile.arrayBuffer());
  const { documentXml, numberingXml } = extractWordDocumentParts(buffer);

  return convertWordDocumentXmlToTiptap(documentXml, numberingXml) as TiptapDocument;
};
