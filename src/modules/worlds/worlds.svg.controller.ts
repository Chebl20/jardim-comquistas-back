import { Controller, Get, Post, Param, Body, Res, HttpStatus, Query, Logger } from '@nestjs/common';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Response } from 'express';
import { parseSVGLayout } from './svg-parser';
import { WorldsConfigService } from './worlds-config.service';
import { WorldsService } from './worlds.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { prisma } from '../../prisma/client';

@Controller('api/worlds')
export class WorldsSvgController {
  constructor(
    private readonly configService: WorldsConfigService,
    private readonly worldsService: WorldsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Get(':id/svg')
  async getSvg(@Param('id') id: string, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');

    const world = await this.worldsService.getWorldById(safeId);
    if (!world) return res.status(HttpStatus.NOT_FOUND).send('world not found');

    const svgPath = join(process.cwd(), world.svgPath);
    if (!existsSync(svgPath)) return res.status(HttpStatus.NOT_FOUND).send('svg file not found');

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    const stream = createReadStream(svgPath);
    stream.on('error', () => res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('error reading file'));
    stream.pipe(res);
  }

  @Get()
  async getWorlds() {
    const worlds = await this.worldsService.getAllWorlds();
    // Return a summarized view (no large config payload)
    return worlds.map((w: any) => {
      let bgPublicUrl: string | undefined;
      try {
        if (typeof w.svgPath === 'string' && w.svgPath.startsWith('supabase://')) {
          const rest = w.svgPath.replace(/^supabase:\/\//, ''); // bucket/path...
          const parts = rest.split('/');
          const bucket = parts.shift();
          const p = parts.join('/');
          const supaUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
          if (bucket && p && supaUrl) bgPublicUrl = `${supaUrl}/storage/v1/object/public/${bucket}/${p}`;
        }
      } catch {}
      return {
        worldId: w.worldId,
        name: w.name,
        svgPath: w.svgPath,
        bgPublicUrl,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      };
    });
  }

  @Post('scan')
  async scanWorlds(@Query('bucket') bucket?: string, @Query('debug') debug?: string) {
    const logger = new Logger('WorldsScan');
    const client = this.supabaseService.getClient();
    const dbg = debug === '1' || debug === 'true';
    const bucketName = bucket || process.env.SUPABASE_BUCKET || 'jardim-das-conquistas';

    // recursive list under 'words/' similar to TreesImportService
    const basePrefix = 'words/';
    const queue: string[] = [basePrefix];
    const fileExtRegex = /\.(svg|png|jpg|jpeg)$/i;
    const items: Array<{ path: string }> = [];
    const foldersVisited: string[] = [];

    while (queue.length > 0) {
      const prefix = queue.shift() as string;
      foldersVisited.push(prefix);
      logger.log(`Listing prefix: ${prefix}`);
      const listRes = await client.storage.from(bucketName).list(prefix, { limit: 1000 });
      if (listRes.error) {
        logger.warn(`Error listing prefix '${prefix}': ${listRes.error.message || listRes.error}`);
        continue;
      }
      const data = Array.isArray(listRes.data) ? listRes.data : [];
      if (dbg) logger.log(`Found ${data.length} entries under ${prefix}`);
      for (const it of data) {
        const name = it.name ?? it.id ?? '';
        if (!name) continue;
        if (fileExtRegex.test(name)) {
          const full = `${prefix}${name}`.replace(/\\/g, '/');
          items.push({ path: full });
        } else {
          const nextPrefix = `${prefix}${name}`.replace(/\\/g, '/') + '/';
          queue.push(nextPrefix);
        }
      }
    }

    // group by worldId = first segment after 'words/'
    const worldsMap: Record<string, { anchors?: string; bg?: string; files: string[] }> = {};
    for (const it of items) {
      const rel = it.path.replace(/^words\//, '');
      const segs = rel.split('/').filter(Boolean);
      if (segs.length === 0) continue;
      const worldId = segs[0];
      if (!worldsMap[worldId]) worldsMap[worldId] = { files: [] };
      worldsMap[worldId].files.push(it.path);
      const fname = segs.slice(1).join('/').toLowerCase();
      if (fname === 'anchors.svg' || fname.endsWith('/anchors.svg')) worldsMap[worldId].anchors = it.path;
      if (fname === 'bg.svg' || fname.endsWith('/bg.svg')) worldsMap[worldId].bg = it.path;
    }

    const scanned: string[] = [];
    const errors: any[] = [];
    for (const worldId of Object.keys(worldsMap)) {
      const info = worldsMap[worldId];
      try {
        if (!info.anchors) {
          logger.warn(`No anchors.svg for world ${worldId}, files: ${JSON.stringify(info.files)}`);
          errors.push({ worldId, error: 'anchors_missing', files: info.files });
          continue;
        }
        const anchorsText = await this.supabaseService.getSvgFromStorage(bucketName, info.anchors);
        const anchorsJson = await parseSVGLayout(anchorsText);

        // Ensure world exists before creating worldConfig (worldConfig has FK -> world)
        const name = (this.worldsService as any).deriveName ? (this.worldsService as any).deriveName(worldId) : worldId;
        // Prefer background SVG when available; fall back to anchors if not.
        const resource = info.bg || info.anchors;
        const svgPath = `supabase://${bucketName}/${resource}`;
        await prisma.world.upsert({ where: { worldId }, update: { name, svgPath, updatedAt: new Date() }, create: { worldId, name, svgPath } });

        // Now upsert config
        await this.configService.upsert(worldId, { anchors: anchorsJson as any });

        scanned.push(worldId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Failed processing world ${worldId}: ${msg}`);
        errors.push({ worldId, error: String(err) });
      }
    }

    const result: any = { message: 'Worlds scanned from Supabase', scanned, errors, totalFiles: items.length, foldersVisited };
    if (dbg) result.debug = { items: items.slice(0, 200) };
    return result;
  }

  @Post(':id/svg')
  async uploadSvg(@Param('id') id: string, @Body() body: { svg?: string }, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');

    const svg = body?.svg;
    if (!svg || typeof svg !== 'string') return res.status(HttpStatus.BAD_REQUEST).send('missing svg in body');

    const maxSize = 2 * 1024 * 1024;
    if (Buffer.byteLength(svg, 'utf8') > maxSize) return res.status(HttpStatus.PAYLOAD_TOO_LARGE).send('svg too large');

    const dataDir = join(process.cwd(), 'data', 'worlds');
    const historyDir = join(dataDir, 'history', safeId);
    try {
      require('fs').mkdirSync(dataDir, { recursive: true });
      require('fs').mkdirSync(historyDir, { recursive: true });

      const filePath = join(dataDir, `${safeId}.svg`);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const historyPath = join(historyDir, `${timestamp}.svg`);

      await require('fs').promises.writeFile(filePath, svg, 'utf8');
      await require('fs').promises.writeFile(historyPath, svg, 'utf8');

      return res.status(HttpStatus.CREATED).json({ ok: true, path: filePath, history: historyPath, savedAt: new Date().toISOString() });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }

  @Post(':id/anchors-config/regenerate')
  async regenerateAnchorsConfig(@Param('id') id: string, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');

    const world = await this.worldsService.getWorldById(safeId);
    if (!world) return res.status(HttpStatus.NOT_FOUND).send('world not found');

    const svgPath = join(process.cwd(), world.svgPath);
    if (!existsSync(svgPath)) return res.status(HttpStatus.NOT_FOUND).send('svg file not found');

    try {
      const svgText = readFileSync(svgPath, 'utf8');
      const json = await parseSVGLayout(svgText);
      await this.configService.upsert(safeId, { anchors: json as any });
      return res.status(HttpStatus.OK).json({ ...json, meta: { source: 'regenerated', generatedAt: new Date().toISOString(), includeIds: true } });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }
}

export default WorldsSvgController;
