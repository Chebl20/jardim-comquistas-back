import { Injectable } from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extractAssetKey, isSupabasePublicUrl } from './asset-key.util';
import type { Readable } from 'stream';

type SignedCacheEntry = { url: string; expiresAt: number };

export type S3ObjectResult = {
  body: Readable | null;
  contentType?: string;
  contentLength?: number;
};

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly expiresIn: number;
  private readonly useAssetProxy: boolean;
  private readonly publicBaseUrl: string;
  private readonly cache = new Map<string, SignedCacheEntry>();

  constructor() {
    this.bucket = process.env.S3_BUCKET || '';
    this.expiresIn = Number(process.env.S3_PRESIGNED_EXPIRES || 3600);
    this.useAssetProxy =
      process.env.S3_ASSET_PROXY === 'true' || process.env.S3_ASSET_PROXY === '1';
    this.publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

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

  buildProxyUrl(key: string): string {
    if (!this.publicBaseUrl) {
      throw new Error('PUBLIC_BASE_URL is required when S3_ASSET_PROXY is enabled');
    }
    const encoded = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${this.publicBaseUrl}/api/assets/${encoded}`;
  }

  async getObject(key: string): Promise<S3ObjectResult> {
    if (!key || !this.bucket) {
      return { body: null };
    }

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    return {
      body: (response.Body as Readable) ?? null,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  }

  async getSignedUrl(key: string, expiresIn = this.expiresIn): Promise<string> {
    if (!key) return key;
    if (this.useAssetProxy && this.publicBaseUrl) {
      return this.buildProxyUrl(key);
    }
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
      if (this.useAssetProxy && this.publicBaseUrl) {
        return this.buildProxyUrl(key);
      }
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
