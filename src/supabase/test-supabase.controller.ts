import { Controller, Get, Query } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Controller('test-supabase')
export class TestSupabaseController {
  constructor(private readonly supabaseService: SupabaseService) {}

  @Get('list')
  async listFiles(@Query('bucket') bucket: string, @Query('path') path?: string) {
    if (!bucket) return { ok: false, error: 'bucket não informado' };
    try {
      const client = this.supabaseService.getClient();
      const { data, error } = await client.storage.from(bucket).list(path ?? '', { limit: 100, offset: 0 });
      if (error) return { ok: false, error: error.message };
      return { ok: true, files: data, path: path ?? '' };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }
}