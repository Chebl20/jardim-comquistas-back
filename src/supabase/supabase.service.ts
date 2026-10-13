import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private client: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_KEY!;
    this.client = createClient(url, key);
  }

  getClient() {
    return this.client;
  }

  async getSvgFromStorage(bucket: string, filename: string): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .download(filename);
    if (error) throw error;
    if (!data) throw new Error('Arquivo não encontrado');
    return await data.text();
  }
}
