import { Injectable } from '@nestjs/common';
import { prisma } from '../prisma/client';

export type AnchorsConfig = {
  anchors?: any[];
  viewBox?: { minX: number; minY: number; width: number; height: number };
  meta?: any;
};

@Injectable()
export class WorldsConfigService {
  async getByWorldId(worldId: string) {
    return (prisma as any).worldConfig.findUnique({ where: { worldId } });
  }

  async upsert(worldId: string, payload: { anchors?: any[]; defaultTreeType?: string | null; defaultGrowth?: number | null }) {
    const data: any = {
      worldId,
      anchors: payload.anchors || [],
      defaultTreeType: payload.defaultTreeType ?? null,
      defaultGrowth: payload.defaultGrowth ?? null,
    };
    return (prisma as any).worldConfig.upsert({
      where: { worldId },
      create: data,
      update: data,
    });
  }

  async patch(worldId: string, patch: Partial<{ anchors: any[]; defaultTreeType?: string | null; defaultGrowth?: number | null }>) {
    const existing = await (prisma as any).worldConfig.findUnique({ where: { worldId } });
    if (!existing) {
      return this.upsert(worldId, { anchors: patch.anchors || [], defaultTreeType: patch.defaultTreeType ?? null, defaultGrowth: patch.defaultGrowth ?? null });
    }
    const data: any = {};
    if (patch.anchors !== undefined) data.anchors = patch.anchors;
    if (patch.defaultTreeType !== undefined) data.defaultTreeType = patch.defaultTreeType ?? null;
    if (patch.defaultGrowth !== undefined) data.defaultGrowth = patch.defaultGrowth ?? null;
    return (prisma as any).worldConfig.update({ where: { worldId }, data });
  }

  /**
   * Patch or add a single anchor node identified by layer+slot or by x/y (nearest).
   * Returns the updated WorldConfig record.
   */
  async patchNode(worldId: string, identifier: Partial<{ layer?: string; slot?: string; x?: number; y?: number }>, patch: Partial<{ treeType?: string | null; growth?: number | null; x?: number; y?: number }>) {
    const row = await (prisma as any).worldConfig.findUnique({ where: { worldId } });
    if (!row) throw new Error('config not found');
    // Normaliza anchors independente do formato vindo do Prisma
    let anchors: any[] = [];
    if (Array.isArray(row.anchors)) {
      anchors = [...row.anchors];
    } else if (typeof row.anchors === 'string') {
      try {
        const parsed = JSON.parse(row.anchors);
        anchors = Array.isArray(parsed) ? parsed : [];
      } catch {
        anchors = [];
      }
    } else if (row.anchors && typeof row.anchors === 'object') {
      // caso raro: objeto que contenha anchors
      if (Array.isArray((row.anchors as any).anchors)) anchors = [...(row.anchors as any).anchors];
      else anchors = [];
    } else {
      anchors = [];
    }

    let idx = -1;
    if (identifier.layer && identifier.slot) {
      idx = anchors.findIndex((a) => String(a.layer) === String(identifier.layer) && String(a.slot) === String(identifier.slot));
    }

    // fallback: find by nearest x/y within tolerance
    if (idx === -1 && typeof identifier.x === 'number' && typeof identifier.y === 'number') {
      const tol = 20; // pixels
      let best = { dist: Infinity, i: -1 };
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (typeof a.x === 'number' && typeof a.y === 'number') {
          const dx = a.x - identifier.x;
          const dy = a.y - identifier.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < best.dist) best = { dist: d, i };
        }
      }
      if (best.i !== -1 && best.dist <= tol) idx = best.i;
    }

    let updatedAnchor: any;
    if (idx !== -1) {
      updatedAnchor = { ...anchors[idx], ...patch };
      anchors[idx] = updatedAnchor;
    } else {
      // create new anchor if x/y provided or layer+slot provided
      if (typeof patch.x !== 'number' && typeof patch.y !== 'number' && !(identifier.layer && identifier.slot)) {
        throw new Error('cannot create anchor without coordinates or layer+slot');
      }
      updatedAnchor = {
        layer: identifier.layer ?? (patch as any)['layer'] ?? null,
        slot: identifier.slot ?? (patch as any)['slot'] ?? null,
        x: patch.x ?? identifier.x ?? 0,
        y: patch.y ?? identifier.y ?? 0,
        svgLine: (patch as any)['svgLine'] ?? '',
        width: (patch as any)['width'] ?? 0,
        height: (patch as any)['height'] ?? 0,
        treeType: (patch as any).treeType ?? null,
        growth: (patch as any).growth ?? null,
        ...(patch as any),
      };
      anchors.push(updatedAnchor);
    }

    const saved = await (prisma as any).worldConfig.update({ where: { worldId }, data: { anchors } });
    return { saved, updatedAnchor };
  }
}

export default WorldsConfigService;
