import { IncomingMessage, Server as HttpServer } from "http";
import { eq } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { db } from "..";
import { validateToken } from "../middlewares/protected";
import { profiles } from "../models/profiles";
import { resolveWordFileAccess, loadWordDocumentFromStorage, loadWordCollaborationSnapshot, normalizeWordContent, ensureWordCollaborationDocument, saveWordCollaborationEvent, upsertWordCollaborationSession, markWordCollaborationSessionInactive } from "../services/wordCollaboration";
import CustomError from "../types/errorCustom";
import { errors } from "../utils/errorMessages";
import { HttpStatusCode } from "../types/httpStatusCode";

type WordSocketMessage =
  | {
      type: "sync";
      data: {
        content: unknown;
        versionNumber?: number;
      };
    }
  | {
      type: "presence";
      data: {
        cursorState?: unknown;
        selectionState?: unknown;
      };
    }
  | {
      type: "ping";
    };

type WordSocketMeta = {
  fileId: string;
  userId: string;
  connectionId: string;
};

const rooms = new Map<string, Set<WebSocket>>();
const socketMeta = new Map<WebSocket, WordSocketMeta>();

const sendJson = (socket: WebSocket, payload: unknown) => {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
};

const broadcastToRoom = (
  fileId: string,
  payload: unknown,
  exceptSocket?: WebSocket,
) => {
  const clients = rooms.get(fileId);

  if (!clients) {
    return;
  }

  for (const client of clients) {
    if (client === exceptSocket || client.readyState !== WebSocket.OPEN) {
      continue;
    }

    sendJson(client, payload);
  }
};

const getTokenFromRequest = (request: IncomingMessage) => {
  const requestUrl = new URL(request.url ?? "", "http://localhost");
  const token = requestUrl.searchParams.get("token");
  const fileId = requestUrl.searchParams.get("fileId");
  const connectionId = requestUrl.searchParams.get("connectionId") ?? uuidv4();

  return {
    token,
    fileId,
    connectionId,
  };
};

const closeWithError = (socket: WebSocket, message: string) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(1008, message);
  }
};

export const attachWordCollaborationServer = (server: HttpServer) => {
  const wsServer = new WebSocketServer({
    server,
    path: "/ws/word",
  });

  wsServer.on("connection", async (socket, request) => {
    const { token, fileId, connectionId } = getTokenFromRequest(request);

    if (!token || !fileId) {
      closeWithError(socket, "missing token or file id");
      return;
    }

    try {
      const userData = await validateToken(`Bearer ${token}`);

      const roomData = await db.transaction(async (tx) => {
        const [profile] = await tx
          .select()
          .from(profiles)
          .where(eq(profiles.id, userData.user.id))
          .limit(1);

        if (!profile) {
          throw new CustomError(errors.invalidUser, HttpStatusCode.BAD_REQUEST);
        }

        const { file } = await resolveWordFileAccess(tx, fileId, profile.id, "read");

        let snapshot = await loadWordCollaborationSnapshot(tx, file.id);

        if (!snapshot) {
          const document = await loadWordDocumentFromStorage(file.path);
          const collaborationDocument = await ensureWordCollaborationDocument(
            tx,
            file.id,
            document,
            profile.id,
            1,
          );

          snapshot = {
            document: normalizeWordContent(collaborationDocument.state),
            versionNumber: collaborationDocument.versionNumber,
          };
        }

        const session = await upsertWordCollaborationSession(tx, {
          fileId: file.id,
          userId: profile.id,
          connectionId,
        });

        return {
          file,
          profile,
          snapshot,
          session,
        };
      });

      socketMeta.set(socket, {
        fileId: roomData.file.id,
        userId: roomData.profile.id,
        connectionId,
      });

      if (!rooms.has(roomData.file.id)) {
        rooms.set(roomData.file.id, new Set());
      }

      rooms.get(roomData.file.id)!.add(socket);

      sendJson(socket, {
        type: "ready",
        data: {
          file: roomData.file,
          collaboration: roomData.snapshot,
          session: roomData.session,
        },
      });

      broadcastToRoom(
        roomData.file.id,
        {
          type: "presence",
          data: {
            userId: roomData.profile.id,
            connectionId,
            joined: true,
          },
        },
        socket,
      );

      socket.on("message", async (rawMessage) => {
        const meta = socketMeta.get(socket);
        if (!meta) {
          return;
        }

        let parsedMessage: WordSocketMessage;

        try {
          parsedMessage = JSON.parse(rawMessage.toString()) as WordSocketMessage;
        } catch {
          sendJson(socket, {
            type: "error",
            message: "invalid websocket payload",
          });
          return;
        }

        if (parsedMessage.type === "ping") {
          sendJson(socket, { type: "pong" });
          return;
        }

        if (parsedMessage.type === "presence") {
          await db.transaction(async (tx) => {
            await upsertWordCollaborationSession(tx, {
              fileId: meta.fileId,
              userId: meta.userId,
              connectionId: meta.connectionId,
              cursorState: parsedMessage.data.cursorState,
              selectionState: parsedMessage.data.selectionState,
            });
          });

          broadcastToRoom(
            meta.fileId,
            {
              type: "presence",
              data: {
                userId: meta.userId,
                connectionId: meta.connectionId,
                cursorState: parsedMessage.data.cursorState,
                selectionState: parsedMessage.data.selectionState,
              },
            },
            socket,
          );
          return;
        }

        if (parsedMessage.type === "sync") {
          const content = normalizeWordContent(parsedMessage.data.content);

          const updatedSnapshot = await db.transaction(async (tx) => {
            const [profile] = await tx
              .select()
              .from(profiles)
              .where(eq(profiles.id, meta.userId))
              .limit(1);

            if (!profile) {
              throw new CustomError(
                errors.invalidUser,
                HttpStatusCode.BAD_REQUEST,
              );
            }

            const { file } = await resolveWordFileAccess(tx, meta.fileId, meta.userId, "write");
            const collaborationDocument = await ensureWordCollaborationDocument(
              tx,
              file.id,
              content,
              meta.userId,
              parsedMessage.data.versionNumber,
            );

            await saveWordCollaborationEvent(
              tx,
              file.id,
              meta.userId,
              "sync",
              {
                versionNumber: collaborationDocument.versionNumber,
              },
            );

            return {
              document: normalizeWordContent(collaborationDocument.state),
              versionNumber: collaborationDocument.versionNumber,
            };
          });

          broadcastToRoom(
            meta.fileId,
            {
              type: "state-updated",
              data: {
                fileId: meta.fileId,
                userId: meta.userId,
                connectionId: meta.connectionId,
                collaboration: updatedSnapshot,
              },
            },
            socket,
          );
          return;
        }
      });

      socket.on("close", async () => {
        const meta = socketMeta.get(socket);
        socketMeta.delete(socket);

        if (!meta) {
          return;
        }

        const clients = rooms.get(meta.fileId);
        clients?.delete(socket);

        if (clients && clients.size === 0) {
          rooms.delete(meta.fileId);
        }

        await db.transaction(async (tx) => {
          await markWordCollaborationSessionInactive(
            tx,
            meta.fileId,
            meta.userId,
            meta.connectionId,
          );
        });

        broadcastToRoom(meta.fileId, {
          type: "presence",
          data: {
            userId: meta.userId,
            connectionId: meta.connectionId,
            joined: false,
          },
        });
      });
    } catch (error) {
      const message =
        error instanceof CustomError ? error.message : "failed to join room";
      closeWithError(socket, message);
    }
  });

  return wsServer;
};
