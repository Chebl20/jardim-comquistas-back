import { Injectable } from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extractAssetKey, isSupabasePublicUrl } from './asset-key.util';

type SignedCacheEntry = { url: string; expiresAt: number };

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly expiresIn: number;
  private readonly cache = new Map<string, SignedCacheEntry>();

  constructor() {
    this.bucket = process.env.S3_BUCKET || '';
    this.expiresIn = Number(process.env.S3_PRESIGNED_EXPIRES || 3600);

    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'garage',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
      forcePathStyle: true,
    });
  }

  async getSignedUrl(key: string, expiresIn = this.expiresIn): Promise<string> {
    if (!key) return key;
    if (!this.bucket) {
      throw new Error('S3_BUCKET is not configured');
    }

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn });
    const cacheTtlMs = Math.max(0, expiresIn - 60) * 1000;
    this.cache.set(key, { url, expiresAt: Date.now() + cacheTtlMs });
    return url;
  }

  async resolveAsset(value: string): Promise<string> {
    if (!value) return value;

    const key = extractAssetKey(value, {
      bucket: this.bucket,
      endpoint: process.env.S3_ENDPOINT,
    });
    if (key) {
      return this.getSignedUrl(key);
    }

    if (isSupabasePublicUrl(value)) {
      return value;
    }

    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }

    return value;
  }

  async signStages(stages: any): Promise<any> {
    if (!stages || typeof stages !== 'object') return stages;

    const result = structuredClone(stages);
    const entries = Array.isArray(result) ? result : Object.values(result);

    for (const stage of entries) {
      if (!stage || typeof stage !== 'object') continue;
      if (typeof stage.svg === 'string') {
        stage.svg = await this.resolveAsset(stage.svg);
      }
      if (typeof stage.png === 'string') {
        stage.png = await this.resolveAsset(stage.png);
      }
    }

    return result;
  }

  async signTreeCatalog<T extends { stages?: any }>(catalog: T | null | undefined): Promise<T | null | undefined> {
    if (!catalog) return catalog;
    return {
      ...catalog,
      stages: await this.signStages(catalog.stages),
    };
  }

  async signPlantedTree<T extends { treeCatalog?: any }>(planted: T | null | undefined): Promise<T | null | undefined> {
    if (!planted?.treeCatalog) return planted;
    return {
      ...planted,
      treeCatalog: await this.signTreeCatalog(planted.treeCatalog),
    };
  }
}
