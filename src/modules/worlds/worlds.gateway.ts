import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { verifyAuthToken } from '../../auth/auth.guard';

function userWorldRoom(worldId: string, userId: string) {
  return `world:${worldId}:user:${userId}`;
}

function extractSocketToken(client: Socket): string | null {
  const auth = (client.handshake?.auth || {}) as Record<string, unknown>;
  const q = client.handshake?.query || {};
  const headers = client.handshake?.headers || {};
  const raw =
    auth.token ||
    auth.accessToken ||
    auth.authorization ||
    q.token ||
    headers.authorization;
  if (!raw) return null;
  const value = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw);
  const token = value.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

@WebSocketGateway({ namespace: '/worlds', cors: { origin: '*' } })
@Injectable()
export class WorldsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WorldsGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    try {
      const q =
        client.handshake && client.handshake.query
          ? client.handshake.query
          : {};
      const token = extractSocketToken(client);
      let userId: string | null = null;
      if (token) {
        try {
          userId = verifyAuthToken(token).userId;
        } catch {
          this.logger.warn(
            `socket ${client.id} presented invalid auth token — rooms not joined`,
          );
        }
      }
      (client.data as { userId?: string }).userId = userId ?? undefined;
      this.logger.log(
        `socket connected: id=${client.id} addr=${client.handshake.address || 'unknown'} authenticated=${Boolean(userId)}`,
      );
      const worldId =
        q && (q.worldId || q.room) ? String(q.worldId || q.room) : null;
      if (worldId && userId) client.join(userWorldRoom(worldId, userId));
      client.on('join', (data: any) => {
        try {
          const wid = data && data.worldId ? String(data.worldId) : null;
          const uid = (client.data as { userId?: string }).userId;
          if (wid && uid) client.join(userWorldRoom(wid, uid));
        } catch (e) {}
      });
    } catch (e) {
      this.logger.warn('handleConnection error: ' + String(e));
    }
  }

  handleDisconnect(client: Socket) {
    try {
      this.logger.log(`socket disconnected: id=${client.id}`);
    } catch (e) {
      this.logger.warn('handleDisconnect error: ' + String(e));
    }
  }

  emitTreePlanted(worldId: string, plantedTree: any, userId?: string | null) {
    try {
      if (!userId) {
        this.logger.warn(
          `skip tree:planted for world:${worldId} — missing userId`,
        );
        return;
      }
      const room = userWorldRoom(worldId, userId);
      const payload = {
        worldId,
        payload: plantedTree,
        emittedAt: new Date().toISOString(),
      };
      this.server?.to(room).emit('tree:planted', payload);
      this.logger.log(
        `emit tree:planted to ${room} plantedId=${plantedTree?.id}`,
      );
    } catch (e) {
      this.logger.warn('emitTreePlanted failed: ' + String(e));
    }
  }

  emitTreeProgress(
    worldId: string,
    plantedTreeId: string,
    stage: number,
    previousStage?: number,
    actor?: string | null,
  ) {
    try {
      if (!actor) {
        this.logger.warn(
          `skip tree:progress for world:${worldId} plantedId=${plantedTreeId} — missing userId`,
        );
        return;
      }
      const room = userWorldRoom(worldId, actor);
      const payload = {
        worldId,
        payload: { plantedTreeId, previousStage, stage, actor },
        emittedAt: new Date().toISOString(),
      };
      this.server?.to(room).emit('tree:progress', payload);
      this.logger.log(
        `emit tree:progress to ${room} plantedId=${plantedTreeId} stage=${stage}`,
      );
    } catch (e) {
      this.logger.warn('emitTreeProgress failed: ' + String(e));
    }
  }
}

export default WorldsGateway;
