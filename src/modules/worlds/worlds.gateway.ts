import { Injectable, Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/worlds', cors: { origin: '*' } })
@Injectable()
export class WorldsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WorldsGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    try {
      const q = client.handshake && client.handshake.query ? client.handshake.query : {};
      this.logger.log(`socket connected: id=${client.id} addr=${client.handshake.address || 'unknown'} query=${JSON.stringify(q)}`);
      // allow clients to join a world room via query or join event
      const worldId = q && (q.worldId || q.room) ? String(q.worldId || q.room) : null;
      if (worldId) client.join(`world:${worldId}`);
      client.on('join', (data: any) => {
        try {
          const wid = data && data.worldId ? String(data.worldId) : null;
          if (wid) client.join(`world:${wid}`);
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

  emitTreePlanted(worldId: string, plantedTree: any) {
    try {
      const payload = { worldId, payload: plantedTree, emittedAt: new Date().toISOString() };
      this.server?.to(`world:${worldId}`).emit('tree:planted', payload);
      this.logger.log(`emit tree:planted to world:${worldId} plantedId=${plantedTree?.id}`);
    } catch (e) {
      this.logger.warn('emitTreePlanted failed: ' + String(e));
    }
  }

  emitTreeProgress(worldId: string, plantedTreeId: string, stage: number, previousStage?: number, actor?: string | null) {
    try {
      const payload = { worldId, payload: { plantedTreeId, previousStage, stage, actor: actor ?? null }, emittedAt: new Date().toISOString() };
      this.server?.to(`world:${worldId}`).emit('tree:progress', payload);
      this.logger.log(`emit tree:progress to world:${worldId} plantedId=${plantedTreeId} stage=${stage}`);
    } catch (e) {
      this.logger.warn('emitTreeProgress failed: ' + String(e));
    }
  }
}

export default WorldsGateway;
