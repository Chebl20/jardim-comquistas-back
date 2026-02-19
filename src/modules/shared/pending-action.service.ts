import { Injectable } from '@nestjs/common';

type Pending = {
  intent: string;
  data: any;
  createdAt: number;
};

@Injectable()
export class PendingActionService {
  private map: Map<string, Pending> = new Map();

  setPending(userId: string, action: { intent: string; data: any }) {
    this.map.set(userId, { intent: action.intent, data: action.data || {}, createdAt: Date.now() });
  }

  getPending(userId: string) {
    return this.map.get(userId) || null;
  }

  consumePending(userId: string) {
    const p = this.map.get(userId) || null;
    if (p) this.map.delete(userId);
    return p;
  }

  clear(userId: string) {
    this.map.delete(userId);
  }
}
