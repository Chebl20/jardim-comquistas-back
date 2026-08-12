/**
 * Migration: converte TreeCatalog.stages de URLs Coolify/Garage
 * (https://s3-.../jardim-das-conquistas/assets/...) para keys (assets/...).
 * URLs públicas do Supabase são mantidas — o backend ainda as resolve.
 *
 * Uso: npx ts-node -r tsconfig-paths/register scripts/migrate-tree-catalog-keys.ts
 *      ou: npm run migrate:tree-catalog-keys
 */

import { prisma } from '../src/prisma/client';
import { extractAssetKey, isSupabasePublicUrl } from '../src/storage/asset-key.util';

function convertAssetValue(value: unknown): { next: unknown; changed: boolean } {
  if (typeof value !== 'string' || !value) return { next: value, changed: false };
  if (value.startsWith('assets/')) return { next: value, changed: false };
  if (isSupabasePublicUrl(value)) return { next: value, changed: false };

  const key = extractAssetKey(value);
  if (key && key !== value) return { next: key, changed: true };
  return { next: value, changed: false };
}

function convertStages(stages: unknown): { next: unknown; fieldsChanged: number } {
  if (!stages || typeof stages !== 'object') return { next: stages, fieldsChanged: 0 };
  const next = structuredClone(stages) as Record<string, any> | any[];
  let fieldsChanged = 0;
  const entries = Array.isArray(next) ? next : Object.values(next);
  for (const stage of entries) {
    if (!stage || typeof stage !== 'object') continue;
    for (const field of ['png', 'svg'] as const) {
      const result = convertAssetValue(stage[field]);
      if (result.changed) {
        stage[field] = result.next;
        fieldsChanged += 1;
      }
    }
  }
  return { next, fieldsChanged };
}

async function main() {
  const catalogs = await prisma.treeCatalog.findMany();
  let recordsUpdated = 0;
  let fieldsChanged = 0;

  for (const catalog of catalogs) {
    const converted = convertStages(catalog.stages);
    if (converted.fieldsChanged === 0) continue;

    await prisma.treeCatalog.update({
      where: { id: catalog.id },
      data: { stages: converted.next as any },
    });
    recordsUpdated += 1;
    fieldsChanged += converted.fieldsChanged;
    console.log(
      `updated ${catalog.id} (${catalog.family}/${catalog.type}): ${converted.fieldsChanged} fields`,
    );
  }

  console.log(`done: ${recordsUpdated} catalogs, ${fieldsChanged} fields converted`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
