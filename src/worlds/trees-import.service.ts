import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
// Note: trees-state, anchor-key and utils were removed; keep import logic self-contained
import { prisma } from '../prisma/client';

@Injectable()
export class TreesImportService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async importFromSupabase(worldId: string, bucket: string, folder: string, family?: string, debug?: boolean) {
    // Do NOT read world config or anchors here. Import-only: list files and build catalog.

    // normalize folder prefix
    let folderNorm = (folder || '').replace(/^\/+|\/+$/g, '');
    const basePrefix = folderNorm + (folderNorm ? '/' : '');

    const client = this.supabaseService.getClient();

    // try listing whole bucket (then filter), fallback to listing the folder
    let items: any[] = [];
    try {
      const allRes = await client.storage.from(bucket).list('', { limit: 100000 });
      if (!allRes.error && Array.isArray(allRes.data)) {
        items = (allRes.data as any[]).filter((it) => {
          const p = it.name ?? it.path ?? it.id ?? '';
          return p && p.startsWith(basePrefix);
        }).map((it) => ({ path: it.name ?? it.path ?? it.id }));
      }
    } catch (e) {
      // ignore and fallback
    }
    if (!items || items.length === 0) {
      const listRes = await client.storage.from(bucket).list(basePrefix, { limit: 1000 });
      if (listRes.error) throw listRes.error;
      items = (listRes.data || []).map((it: any) => ({ path: `${basePrefix}${it.name}` }));
    }

    // build family -> stages map
    const familyMap: Record<string, { stages: Record<number, { svg?: string; png?: string }> }> = {};
    const stageRegex = /^(\d+)\.(svg|png|jpg|jpeg)$/i;
    for (const it of items) {
      const p: string = it.path || it.name || it.file_name || '';
      if (!p) continue;
      // relative path after basePrefix
      const rel = p.startsWith(basePrefix) ? p.slice(basePrefix.length) : p;
      const segs = rel.split('/').filter(Boolean);
      if (segs.length === 0) continue;
      // family is either explicit (folder included) or first segment
      const explicitFamily = folderNorm.includes('/') ? folderNorm.split('/').pop() : undefined;
      const familyName = explicitFamily || segs[0];
      const filename = segs[segs.length - 1];
      const m = filename.match(stageRegex);
      if (!m) continue;
      const num = Number(m[1]);
      const ext = m[2].toLowerCase();
      familyMap[familyName] = familyMap[familyName] || { stages: {} };
      const fullPath = `${basePrefix}${segs.join('/')}`;
      familyMap[familyName].stages[num] = familyMap[familyName].stages[num] || {};
      if (ext === 'svg') familyMap[familyName].stages[num].svg = fullPath;
      else familyMap[familyName].stages[num].png = fullPath;
    }

    // optionally restrict to a single family param
    const families = Object.keys(familyMap).filter(Boolean).sort();
    const targetFamilies = family ? families.filter((f) => String(f) === String(family)) : families;

    const created: any[] = [];
    const updated: any[] = [];
    const skipped: any[] = [];
    const already: any[] = [];
    const catalogsOutput: any[] = [];
const explicitFamily = folderNorm.includes('/') ? folderNorm.split('/').pop() : undefined;
    for (const fam of targetFamilies) {
      const stages = familyMap[fam].stages || {};
      const stageNums = Object.keys(stages).map((s) => Number(s)).filter(Boolean).sort((a, b) => a - b);
      if (stageNums.length === 0) {
        skipped.push({ family: fam, reason: 'no stages found' });
        continue;
      }
      const maxStage = stageNums[stageNums.length - 1];
      // build assets as an array of stage objects [{ stage, svg?, png? }, ...]
      const srec = stages[maxStage] || {};
      const stagesArray: Array<any> = [];
      const allStageNums = Object.keys(stages).map((s) => Number(s)).filter(Boolean).sort((a, b) => a - b);
      for (const sn of allStageNums) {
        const rec = stages[sn] || {};
        const obj: any = { stage: sn };
        if (rec.svg) obj.svg = rec.svg;
        if (rec.png) obj.png = rec.png;
        stagesArray.push(obj);
      }
      const assetsByStage: any = { stages: stagesArray, currentStage: maxStage };

      // Build a single TreeCatalog for this family with stages as JSON and handle duplicates
      const catalogStages = stages; // Record<number, {svg?, png?}>
      if ((prisma as any).treeCatalog) {
        const existing = await (prisma as any).treeCatalog.findFirst({ where: { family: fam } });
        if (existing) {
          // compare existing stages with new stages
          try {
            const existingJson = JSON.stringify(existing.stages || {});
            const newJson = JSON.stringify(catalogStages || {});
            if (existingJson === newJson) {
              // already imported identical catalog
              already.push({ family: fam, id: existing.id });
              catalogsOutput.push({ family: fam, stages: catalogStages, maxStage, catalogId: existing.id, status: 'already' });
              continue;
            }
          } catch (e) {
            // fallthrough to update if comparison fails
          }
          // different content -> update
          const up = await (prisma as any).treeCatalog.update({ where: { id: existing.id }, data: { stages: catalogStages } });
          updated.push({ family: fam, id: up.id });
          catalogsOutput.push({ family: fam, stages: catalogStages, maxStage, catalogId: up.id, status: 'updated' });
        } else {
          const createdRow = await (prisma as any).treeCatalog.create({ data: { family: fam, stages: catalogStages } });
          created.push({ family: fam, id: createdRow.id });
          catalogsOutput.push({ family: fam, stages: catalogStages, maxStage, catalogId: createdRow.id, status: 'created' });
        }
      } else {
        catalogsOutput.push({ family: fam, stages: catalogStages, maxStage, catalogId: null, status: 'noop' });
      }
    }

    // prepare output
    const output = {
      worldId,
      bucket,
      folder,
      itemsCount: items.length,
      createdCount: created.length,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      families: catalogsOutput,
    };

    const result: any = { ok: true, created, updated, skipped, families: catalogsOutput };
    if (debug) {
      result.debug = { familiesFound: Object.keys(familyMap).length, itemsCount: items.length };
    }

    console.log('trees.import', { worldId, bucket, folder, family, result });
    return result;
  }
}
