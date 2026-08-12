import { Controller, Post, Get, Delete, Param, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { TreesImportService } from './trees-import.service';
import { prisma } from '../../prisma/client';
import { StorageService } from '../../storage/storage.service';

@ApiTags('Mundos — Catálogo de Árvores')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/worlds')
export class WorldsTreesController {
  constructor(
    private readonly importService: TreesImportService,
    private readonly storageService: StorageService,
  ) {}

  @Post(':id/trees/import-from-supabase')
  @ApiOperation({ summary: 'Importar árvores do Supabase', description: 'Importa o catálogo de árvores a partir do bucket do Supabase para um mundo específico.' })
  @ApiParam({ name: 'id', description: 'ID do mundo' })
  @ApiQuery({ name: 'bucket', required: true, description: 'Nome do bucket no Supabase' })
  @ApiQuery({ name: 'folder', required: false, description: 'Pasta dentro do bucket' })
  @ApiQuery({ name: 'family', required: false, description: 'Família de árvores' })
  @ApiQuery({ name: 'debug', required: false, description: 'Ativar debug (1 ou true)' })
  @ApiResponse({ status: 201, description: 'Árvores importadas.' })
  async importFromSupabase(
    @Param('id') id: string,
    @Query('bucket') bucket: string,
    @Query('folder') folder: string,
    @Query('family') family?: string,
    @Query('debug') debug?: string,
  ) {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');
    if (!bucket) throw new BadRequestException('missing bucket query');
    const dbg = debug === '1' || debug === 'true';
    return this.importService.importFromSupabase(safeId, bucket, folder || '', family, dbg);
  }

  @Post('trees/import-from-supabase')
  @ApiOperation({ summary: 'Importar árvores do Supabase (global)', description: 'Importa árvores sem especificar mundo — usa pasta assets/ por padrão.' })
  @ApiQuery({ name: 'bucket', required: true, description: 'Nome do bucket no Supabase' })
  @ApiQuery({ name: 'folder', required: false, description: 'Pasta (padrão: assets)' })
  @ApiQuery({ name: 'family', required: false, description: 'Família de árvores' })
  @ApiQuery({ name: 'debug', required: false, description: 'Ativar debug (1 ou true)' })
  @ApiResponse({ status: 201, description: 'Árvores importadas.' })
  async importFromSupabaseNoId(
    @Query('bucket') bucket: string,
    @Query('folder') folder?: string,
    @Query('family') family?: string,
    @Query('debug') debug?: string,
  ) {
    if (!bucket) throw new BadRequestException('missing bucket query');
    const dbg = debug === '1' || debug === 'true';
    const useFolder = (folder && String(folder).trim().length > 0) ? folder : 'assets';
    return this.importService.importFromSupabase(undefined as any, bucket, useFolder, family, dbg);
  }

  @Get(':id/trees')
  @ApiOperation({ summary: 'Listar catálogo de árvores', description: 'Retorna todo o catálogo de árvores cadastrado.' })
  @ApiParam({ name: 'id', description: 'ID do mundo' })
  @ApiResponse({ status: 200, description: 'Catálogo retornado.' })
  async listTreeCatalog(@Param('id') id: string) {
    const catalogs = await prisma.treeCatalog.findMany({ orderBy: { family: 'asc' } });
    return Promise.all(catalogs.map((catalog) => this.storageService.signTreeCatalog(catalog)));
  }

  @Delete(':id/trees')
  @ApiOperation({ summary: 'Limpar catálogo de árvores', description: 'Remove todas as árvores do catálogo. Requer confirm=1.' })
  @ApiParam({ name: 'id', description: 'ID do mundo' })
  @ApiQuery({ name: 'confirm', required: true, description: 'Confirmação (1 ou true)' })
  @ApiResponse({ status: 200, description: 'Catálogo limpo.' })
  async clearTreeCatalog(@Param('id') id: string, @Query('confirm') confirm?: string) {
    const safeId = String(id || '').replace(/[^a-zA-Z0-9-_]/g, '');
    if (!safeId) throw new BadRequestException('invalid world id');

    const doClear = confirm === '1' || confirm === 'true';
    if (!doClear) throw new BadRequestException('confirm=1 is required to clear the catalog');

    const result = await prisma.treeCatalog.deleteMany();
    return { ok: true, cleared: true, deleted: result.count ?? result };
  }
}

export default WorldsTreesController;
