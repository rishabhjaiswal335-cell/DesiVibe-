import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { resolveUserFromToken } from './auth.ts';
import { db } from './db.ts';

class RealtimeHub {
  private wss: WebSocketServer | null = null;
  private userSockets = new Map<string, Set<WebSocket>>();

  init(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      let userId: string | null = null;

      try {
        const url = new URL(req.url || '/', 'http://localhost');
        const token = url.searchParams.get('token');
        const user = resolveUserFromToken(token);
        if (user && user.account_status === 'active') {
          userId = user.id;
          this.addSocket(userId, ws);
        }
      } catch {
        // Anonymous guest socket can receive public broadcasts
      }

      ws.send(
        JSON.stringify({
          event: 'connected',
          payload: {
            authenticated: Boolean(userId),
            onlineUserIds: this.getOnlineUserIds(),
          },
        })
      );

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (!userId) return;

          if (msg.event === 'chat:typing' && msg.payload?.conversationId) {
            const members = db
              .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
              .all(msg.payload.conversationId) as { user_id: string }[];

            const isMember = members.some((m) => m.user_id === userId);
            if (!isMember) return;

            for (const member of members) {
              if (member.user_id !== userId) {
                this.emitToUser(member.user_id, 'chat:typing', {
                  conversationId: msg.payload.conversationId,
                  userId,
                  isTyping: Boolean(msg.payload.isTyping),
                });
              }
            }
          }

          if (msg.event === 'presence:ping') {
            db.prepare('UPDATE profiles SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
          }
        } catch {
          // Ignore malformed client frames
        }
      });

      ws.on('close', () => {
        if (userId) {
          this.removeSocket(userId, ws);
        }
      });
    });
  }

  private addSocket(userId: string, ws: WebSocket) {
    let set = this.userSockets.get(userId);
    const wasOffline = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.userSockets.set(userId, set);
    }
    set.add(ws);
    db.prepare('UPDATE profiles SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    if (wasOffline) {
      this.broadcast('presence:update', { userId, online: true, onlineUserIds: this.getOnlineUserIds() });
    }
  }

  private removeSocket(userId: string, ws: WebSocket) {
    const set = this.userSockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.userSockets.delete(userId);
      db.prepare('UPDATE profiles SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
      this.broadcast('presence:update', { userId, online: false, onlineUserIds: this.getOnlineUserIds() });
    }
  }

  getOnlineUserIds(): string[] {
    return Array.from(this.userSockets.keys());
  }

  isUserOnline(userId: string): boolean {
    const set = this.userSockets.get(userId);
    return Boolean(set && set.size > 0);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    const set = this.userSockets.get(userId);
    if (!set) return;
    const data = JSON.stringify({ event, payload });
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  emitToUsers(userIds: string[], event: string, payload: unknown) {
    for (const id of userIds) {
      this.emitToUser(id, event, payload);
    }
  }

  broadcast(event: string, payload: unknown) {
    if (!this.wss) return;
    const data = JSON.stringify({ event, payload });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}

export const realtime = new RealtimeHub();
