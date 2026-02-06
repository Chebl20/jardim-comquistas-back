import { Controller, Get, Param, Res, HttpStatus, Post, Body, Put, Patch, BadRequestException } from '@nestjs/common';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Response } from 'express';
import { parseSVGLayout } from './svg-parser';
import { WorldsConfigService } from './worlds-config.service';

@Controller('api/worlds')
export class WorldsController {
  constructor(private readonly configService: WorldsConfigService) {}
  @Get(':id/svg')
  getSvg(@Param('id') id: string, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');

    const candidatePaths = [
      join(process.cwd(), 'src', 'assets', 'worlds', `${safeId}.svg`),
      join(process.cwd(), 'dist', 'assets', 'worlds', `${safeId}.svg`),
      join(__dirname, '..', 'assets', 'worlds', `${safeId}.svg`),
    ];

    const svgPath = candidatePaths.find((p) => existsSync(p));
    if (!svgPath) return res.status(HttpStatus.NOT_FOUND).send('svg not found');

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    const stream = createReadStream(svgPath);
    stream.on('error', () => res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('error reading file'));
    stream.pipe(res);
  }

  @Post(':id/svg')
  async uploadSvg(@Param('id') id: string, @Body() body: { svg?: string }, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');

    const svg = body?.svg;
    if (!svg || typeof svg !== 'string') return res.status(HttpStatus.BAD_REQUEST).send('missing svg in body');

    // limita tamanho (2MB)
    const maxSize = 2 * 1024 * 1024;
    if (Buffer.byteLength(svg, 'utf8') > maxSize) return res.status(HttpStatus.PAYLOAD_TOO_LARGE).send('svg too large');

    const dataDir = join(process.cwd(), 'data', 'worlds');
    const historyDir = join(dataDir, 'history', safeId);
    try {
      // criar pastas se necessário
      require('fs').mkdirSync(dataDir, { recursive: true });
      require('fs').mkdirSync(historyDir, { recursive: true });

      const filePath = join(dataDir, `${safeId}.svg`);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const historyPath = join(historyDir, `${timestamp}.svg`);

      // salvar atual e cópia de histórico
      await require('fs').promises.writeFile(filePath, svg, 'utf8');
      await require('fs').promises.writeFile(historyPath, svg, 'utf8');

      return res.status(HttpStatus.CREATED).json({ ok: true, path: filePath, history: historyPath, savedAt: new Date().toISOString() });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }

  @Get(':id/anchors-config')
  async getAnchorsConfig(@Param('id') id: string, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');

    const candidatePaths = [
      join(process.cwd(), 'src', 'assets', 'worlds', `${safeId}.svg`),
      join(process.cwd(), 'dist', 'assets', 'worlds', `${safeId}.svg`),
      join(__dirname, '..', 'assets', 'worlds', `${safeId}.svg`),
      join(process.cwd(), 'data', 'worlds', `${safeId}.svg`),
    ];
    const svgPath = candidatePaths.find((p) => existsSync(p));
    if (!svgPath) return res.status(HttpStatus.NOT_FOUND).send('svg not found');

    try {
      // Verifica se já existe configuração salva no banco
      const saved = await this.configService.getByWorldId(safeId);
      if (saved && saved.anchors) {
        // normalize various stored shapes to a payload with anchors[] and optional viewBox
        let payload: any = { anchors: [] };
        const a = saved.anchors;
        if (Array.isArray(a)) {
          payload.anchors = a;
        } else if (a && typeof a === 'object') {
          if (Array.isArray(a.anchors)) {
            payload.anchors = a.anchors;
            if (a.viewBox) payload.viewBox = a.viewBox;
          } else {
            // numeric-keyed object -> convert to array
            const keys = Object.keys(a || {}).filter((k) => /^\d+$/.test(k)).sort((x, y) => Number(x) - Number(y));
            if (keys.length > 0) {
              payload.anchors = keys.map((k) => a[k]);
            }
            if (a.viewBox) payload.viewBox = a.viewBox;
          }
        }
        return res.status(HttpStatus.OK).json({ ...payload, meta: { version: '1.0', source: 'db', updatedAt: saved.updatedAt } });
      }

      // Gera a configuração usando o parser e salva para uso futuro
      const svgText = readFileSync(svgPath, 'utf8');
      const json = await parseSVGLayout(svgText);
      await this.configService.upsert(safeId, { anchors: json as any });
      return res.status(HttpStatus.OK).json({ ...json, meta: { version: '1.0', source: 'generated', generatedAt: new Date().toISOString() } });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }



  @Post(':id/anchors-config/regenerate')
  async regenerateAnchorsConfig(@Param('id') id: string, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');

    const candidatePaths = [
      join(process.cwd(), 'src', 'assets', 'worlds', `${safeId}.svg`),
      join(process.cwd(), 'dist', 'assets', 'worlds', `${safeId}.svg`),
      join(__dirname, '..', 'assets', 'worlds', `${safeId}.svg`),
      join(process.cwd(), 'data', 'worlds', `${safeId}.svg`),
    ];
    const svgPath = candidatePaths.find((p) => existsSync(p));
    if (!svgPath) return res.status(HttpStatus.NOT_FOUND).send('svg not found');

    try {
      const svgText = readFileSync(svgPath, 'utf8');
      const json = await parseSVGLayout(svgText);
      await this.configService.upsert(safeId, { anchors: json as any });
      return res.status(HttpStatus.OK).json({ ...json, meta: { source: 'regenerated', generatedAt: new Date().toISOString() } });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }

  @Get(':id/config')
  async getConfig(@Param('id') id: string, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');
    try {
      const row = await this.configService.getByWorldId(safeId);
      if (!row) return res.status(HttpStatus.NOT_FOUND).json({ ok: false, error: 'config not found' });
      return res.status(HttpStatus.OK).json(row);
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }

  @Put(':id/config')
  async putConfig(@Param('id') id: string, @Body() body: any, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');
    const { anchors, defaultTreeType, defaultGrowth } = body || {};
    if (defaultGrowth !== undefined && !(Number.isInteger(defaultGrowth) && defaultGrowth >= 1 && defaultGrowth <= 6)) {
      throw new BadRequestException('defaultGrowth must be integer between 1 and 6');
    }
    try {
      const saved = await this.configService.upsert(safeId, { anchors, defaultTreeType, defaultGrowth });
      return res.status(HttpStatus.OK).json(saved);
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }

  @Patch(':id/config')
  async patchConfig(@Param('id') id: string, @Body() body: any, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');
    const { anchors, defaultTreeType, defaultGrowth } = body || {};
    if (defaultGrowth !== undefined && !(Number.isInteger(defaultGrowth) && defaultGrowth >= 1 && defaultGrowth <= 6)) {
      throw new BadRequestException('defaultGrowth must be integer between 1 and 6');
    }
    try {
      const saved = await this.configService.patch(safeId, { anchors, defaultTreeType, defaultGrowth });
      return res.status(HttpStatus.OK).json(saved);
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }

  @Patch(':id/config/node')
  async patchNode(@Param('id') id: string, @Body() body: any, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');

    const { layer, slot, x, y, treeType, growth } = body || {};
    if (growth !== undefined && !(Number.isInteger(growth) && growth >= 1 && growth <= 6)) {
      throw new BadRequestException('growth must be integer between 1 and 6');
    }

    if (!((layer && slot) || (typeof x === 'number' && typeof y === 'number'))) {
      throw new BadRequestException('identify node by layer+slot or x and y');
    }

    try {
      const identifier: any = {};
      if (layer) identifier.layer = String(layer);
      if (slot) identifier.slot = String(slot);
      if (typeof x === 'number') identifier.x = Number(x);
      if (typeof y === 'number') identifier.y = Number(y);

      const patch: any = {};
      if (treeType !== undefined) patch.treeType = treeType;
      if (growth !== undefined) patch.growth = growth;
      if (typeof x === 'number') patch.x = Number(x);
      if (typeof y === 'number') patch.y = Number(y);

      const out = await this.configService.patchNode(safeId, identifier, patch);
      return res.status(HttpStatus.OK).json(out);
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }
}
