import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
// Note: trees-state, anchor-key and utils were removed; keep import logic self-contained
import { prisma } from '../../prisma/client';

@Injectable()
export class TreesImportService {
  private readonly logger = new Logger(TreesImportService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async importFromSupabase(
    worldId: string,
    bucket: string,
    folder: string,
    family?: string,
    debug?: boolean,
  ) {
    // Do NOT read world config or anchors here. Import-only: list files and build catalog.

    // normalize folder prefix; default to 'assets' when not provided
    const folderInput =
      folder && String(folder).trim().length > 0 ? folder : 'assets';
    const folderNorm = (folderInput || '').replace(/^\/+|\/+$/g, '');
    const basePrefix = folderNorm + (folderNorm ? '/' : '');

    const client = this.supabaseService.getClient();

    // list files recursively under the basePrefix (handles folders like assets/continua)
    const items: any[] = [];
    const queue: string[] = [basePrefix];
    const fileExtRegex = /\.(svg|png|jpg|jpeg)$/i;
    while (queue.length > 0) {
      const prefix = queue.shift() || '';
      const listRes = await client.storage
        .from(bucket)
        .list(prefix, { limit: 1000 });
      if (listRes.error) {
        // if listing this prefix fails, continue with others
        continue;
      }
      const data = Array.isArray(listRes.data) ? listRes.data : [];
      for (const it of data) {
        const name = it.name ?? it.id ?? '';
        if (!name) continue;
        // if name looks like a file with extension, record it; else treat as folder and queue it
        if (fileExtRegex.test(name)) {
          const full = `${prefix}${name}`;
          items.push({ path: full });
        } else {
          // queue deeper folder (ensure trailing slash)
          const nextPrefix = `${prefix}${name}`.replace(/\\/g, '/') + '/';
          queue.push(nextPrefix);
        }
      }
    }

    // build family -> stages map
    const stageRegex = /^(\d+)\.(svg|png|jpg|jpeg)$/i;
    // Novo: separar famílias por combinação {type, family}
    type FamKey = string;
    const famMap: Record<
      FamKey,
      {
        family: string;
        type: string;
        stages: Record<number, { svg?: string; png?: string }>;
      }
    > = {};
    for (const it of items) {
      const p: string = it.path || it.name || it.file_name || '';
      if (!p) continue;
      // relative path after basePrefix
      const rel = p.startsWith(basePrefix) ? p.slice(basePrefix.length) : p;
      const segs = rel.split('/').filter(Boolean);
      if (segs.length === 0) continue;
      // determine type by path
      let type = '';
      if (segs.includes('continua')) type = 'continua';
      else if (segs.includes('pontual')) type = 'pontual';
      else type = 'desconhecido';
      // determine family:
      const explicitFamily = folderNorm.includes('/')
        ? folderNorm.split('/').pop()
        : undefined;
      let familyName: string | undefined = explicitFamily;
      if (!familyName) {
        const treesIdx = segs.indexOf('trees');
        if (treesIdx >= 0 && treesIdx + 1 < segs.length - 0) {
          familyName = segs[treesIdx + 1];
        } else if (segs.length >= 2) {
          familyName = segs[segs.length - 2];
        } else {
          familyName = segs[0];
        }
      }
      if (!familyName) continue;
      const famKey = `${type}||${familyName}`;
      if (!famMap[famKey])
        famMap[famKey] = { family: familyName, type, stages: {} };
      const filename = segs[segs.length - 1];
      const m = filename.match(stageRegex);
      if (!m) continue;
      const num = Number(m[1]);
      const ext = m[2].toLowerCase();
      famMap[famKey].stages[num] = famMap[famKey].stages[num] || {};
      if (ext === 'svg')
        famMap[famKey].stages[num].svg = `${basePrefix}${segs.join('/')}`;
      else famMap[famKey].stages[num].png = `${basePrefix}${segs.join('/')}`;
    }
    // converte famMap para familyMap/familyTypeMap
    const familyMap: Record<
      string,
      { stages: Record<number, { svg?: string; png?: string }> }
    > = {};
    const familyTypeMap: Record<string, string> = {};
    const famKeyToFam: Record<string, { family: string; type: string }> = {};
    for (const k of Object.keys(famMap)) {
      const { family, type, stages } = famMap[k];
      // chave única: type||family
      familyMap[k] = { stages };
      familyTypeMap[k] = type;
      famKeyToFam[k] = { family, type };
    }

    // optionally restrict to a single family param
    const families = Object.keys(familyMap).filter(Boolean).sort();
    const targetFamilies = families;

    const created: any[] = [];
    const updated: any[] = [];
    const skipped: any[] = [];
    const already: any[] = [];
    const catalogsOutput: any[] = [];
    const explicitFamily = folderNorm.includes('/')
      ? folderNorm.split('/').pop()
      : undefined;
    for (const famKey of targetFamilies) {
      const { family, type } = famKeyToFam[famKey];
      const stages = familyMap[famKey].stages || {};
      const stageNums = Object.keys(stages)
        .map((s) => Number(s))
        .filter(Boolean)
        .sort((a, b) => a - b);
      if (stageNums.length === 0) {
        skipped.push({ family, type, reason: 'no stages found' });
        continue;
      }
      const maxStage = stageNums[stageNums.length - 1];
      // build assets as an array of stage objects [{ stage, svg?, png? }, ...]
      const srec = stages[maxStage] || {};
      const stagesArray: Array<any> = [];
      const allStageNums = Object.keys(stages)
        .map((s) => Number(s))
        .filter(Boolean)
        .sort((a, b) => a - b);
      for (const sn of allStageNums) {
        const rec = stages[sn] || {};
        const obj: any = { stage: sn };
        if (rec.svg) obj.svg = rec.svg;
        if (rec.png) obj.png = rec.png;
        stagesArray.push(obj);
      }
      const assetsByStage: any = {
        stages: stagesArray,
        currentStage: maxStage,
      };

      // Build a single TreeCatalog para cada combinação {family, type}
      const catalogStages = stages; // Record<number, {svg?, png?}>
      // Persist S3 keys only (no Coolify/Supabase domain)
      const stagesWithUrlsForDb: Record<number, any> = {};
      for (const k of Object.keys(catalogStages || {})) {
        const num = Number(k);
        const rec = (catalogStages as any)[k] || {};
        stagesWithUrlsForDb[num] = {};
        if (rec.png) stagesWithUrlsForDb[num].png = rec.png;
        if (rec.svg) stagesWithUrlsForDb[num].svg = rec.svg;
      }

      if ((prisma as any).treeCatalog) {
        // Busca por family+type
        const existing = await (prisma as any).treeCatalog.findFirst({
          where: { family, type },
        });
        if (existing) {
          // compare stored stages with new keys
          try {
            const existingJson = JSON.stringify(existing.stages || {});
            const newJson = JSON.stringify(stagesWithUrlsForDb || {});
            if (existingJson === newJson && existing.type === type) {
              already.push({ family, type, id: existing.id });
              catalogsOutput.push({
                family,
                type,
                stages: stagesWithUrlsForDb,
                maxStage,
                catalogId: existing.id,
                status: 'already',
              });
              continue;
            }
          } catch (e) {
            // fallthrough to update if comparison fails
          }
          // different content or type -> update DB with keys and type
          const up = await (prisma as any).treeCatalog.update({
            where: { id: existing.id },
            data: { stages: stagesWithUrlsForDb, type },
          });
          updated.push({ family, type, id: up.id });
          catalogsOutput.push({
            family,
            type,
            stages: stagesWithUrlsForDb,
            maxStage,
            catalogId: up.id,
            status: 'updated',
          });
        } else {
          const createdRow = await (prisma as any).treeCatalog.create({
            data: { family, stages: stagesWithUrlsForDb, type },
          });
          created.push({ family, type, id: createdRow.id });
          catalogsOutput.push({
            family,
            type,
            stages: stagesWithUrlsForDb,
            maxStage,
            catalogId: createdRow.id,
            status: 'created',
          });
        }
      } else {
        catalogsOutput.push({
          family,
          type,
          stages: stagesWithUrlsForDb,
          maxStage,
          catalogId: null,
          status: 'noop',
        });
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

    const result: any = {
      ok: true,
      created,
      updated,
      skipped,
      families: catalogsOutput,
    };
    if (debug) {
      result.debug = {
        familiesFound: Object.keys(familyMap).length,
        itemsCount: items.length,
        sampleItems: items.slice(0, 50),
      };
    }

    this.logger.log(
      `trees.import: worldId=${worldId}, bucket=${bucket}, folder=${folder}, family=${family}, result=${JSON.stringify(result)}`,
    );
    return result;
  }
}
