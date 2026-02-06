import { Controller, Get, Param, Res, HttpStatus, Post, Body } from '@nestjs/common';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Response } from 'express';
import { parseSVGLayout } from './svg-parser';

@Controller('api/worlds')
export class WorldsController {
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
      const svgText = readFileSync(svgPath, 'utf8');
      const json = await parseSVGLayout(svgText);
      return res.status(HttpStatus.OK).json({ ...json, meta: { version: '1.0', generatedAt: new Date().toISOString() } });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ ok: false, error: String(err) });
    }
  }
}
