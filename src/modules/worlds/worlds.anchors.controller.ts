import { Controller, Get, Post, Patch, Param, Body, Res, HttpStatus, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WorldsConfigService } from './worlds-config.service';
import { WorldsService } from './worlds.service';

@Controller('api/worlds')
export class WorldsAnchorsController {
  constructor(private readonly configService: WorldsConfigService, private readonly worldsService: WorldsService) {}

  @Get(':id/anchors-config')
  async getAnchorsConfig(@Param('id') id: string, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');
    try {
      // Primeiro tenta retornar o config persistido no banco (caso a sincronização
      // já tenha gerado as anchors). Isso evita depender de arquivos locais
      // (ex: quando o SVG está no Supabase ou foi escaneado remotamente).
      const saved = await this.configService.getByWorldId(safeId);
      if (saved && saved.anchors) {
        let payload: any = { anchors: [] };
        const a = saved.anchors;
        if (Array.isArray(a)) payload.anchors = a;
        else if (a && typeof a === 'object') {
          if (Array.isArray(a.anchors)) {
            payload.anchors = a.anchors;
            if (a.viewBox) payload.viewBox = a.viewBox;
          } else {
            const keys = Object.keys(a || {}).filter((k) => /^\d+$/.test(k)).sort((x, y) => Number(x) - Number(y));
            if (keys.length > 0) payload.anchors = keys.map((k) => a[k]);
            if (a.viewBox) payload.viewBox = a.viewBox;
          }
        }
        return res.status(HttpStatus.OK).json({ ...payload, meta: { version: '1.0', source: 'db', updatedAt: saved.updatedAt } });
      }

      // Não procurar por arquivos locais: os SVGs vivem no Supabase.
      // Se não houver config no DB, retornar instrução para regenerar.
      return res.status(HttpStatus.NOT_FOUND).json({ ok: false, error: 'config not found. Use POST /api/worlds/:id/anchors-config/regenerate to generate it.' });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }

    // Caso o código alcance este ponto (isso não deveria ocorrer) devolve erro genérico
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: 'unexpected error' });
    
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

  @Post(':id/anchors-config/regenerate')
  async regenerateAnchorsConfig(@Param('id') id: string, @Res() res: Response) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) return res.status(HttpStatus.BAD_REQUEST).send('invalid world id');

    try {
      await this.worldsService.regenerateConfig(safeId);
      return res.status(HttpStatus.OK).json({ message: 'Anchors config regenerated' });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }
}

export default WorldsAnchorsController;
