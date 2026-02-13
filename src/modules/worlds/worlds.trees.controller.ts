import { Controller, Post, Get, Delete, Param, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { TreesImportService } from './trees-import.service';
import { prisma } from '../../prisma/client';

@UseGuards(AuthGuard)
@Controller('api/worlds')
export class WorldsTreesController {
  constructor(private readonly importService: TreesImportService) {}

  @Post(':id/trees/import-from-supabase')
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

  @Get(':id/trees')
  async listTreeCatalog(@Param('id') id: string) {
    return prisma.treeCatalog.findMany({ orderBy: { family: 'asc' } });
  }

  @Delete(':id/trees')
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
