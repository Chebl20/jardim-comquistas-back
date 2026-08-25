jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  GetObjectCommand: jest.fn().mockImplementation((input: { Key: string; Bucket: string }) => ({ input })),
}));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

const mockGetSignedUrl = getSignedUrl as jest.Mock;

describe('StorageService.resolveAsset', () => {
  let service: StorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.S3_BUCKET = 'jardim-das-conquistas';
    process.env.S3_ENDPOINT = 'https://s3-hk3uuyv295rhco7h32j0zt4l.coolify.chebl.cloud';
    process.env.S3_REGION = 'garage';
    process.env.S3_ACCESS_KEY = 'test';
    process.env.S3_SECRET_KEY = 'test';
    mockGetSignedUrl.mockImplementation(async (_client: unknown, command: { input: { Key: string } }) => {
      return `https://signed.example/${command.input.Key}?X-Amz-Algorithm=AWS4-HMAC-SHA256`;
    });
    service = new StorageService();
  });

  it('assina keys no formato assets/...', async () => {
    const result = await service.resolveAsset('assets/continua/trees/a/1.svg');
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    expect(result).toBe(
      'https://signed.example/assets/continua/trees/a/1.svg?X-Amz-Algorithm=AWS4-HMAC-SHA256',
    );
  });

  it('extrai a key de URL Coolify path-style e assina', async () => {
    const result = await service.resolveAsset(
      'https://s3-hk3uuyv295rhco7h32j0zt4l.coolify.chebl.cloud/jardim-das-conquistas/assets/continua/trees/a/1.png',
    );
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    expect(result).toBe(
      'https://signed.example/assets/continua/trees/a/1.png?X-Amz-Algorithm=AWS4-HMAC-SHA256',
    );
  });

  it('extrai a key de URL Coolify sem chebl no host', async () => {
    const result = await service.resolveAsset(
      'https://s3-hk3uuyv295rhco7h32j0zt4l.coolify.cloud/jardim-das-conquistas/assets/continua/trees/a/1.svg',
    );
    expect(result).toContain('assets/continua/trees/a/1.svg');
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('devolve URL pública do Supabase intacta', async () => {
    const url =
      'https://fgnernsoessdzkixnnwo.supabase.co/storage/v1/object/public/jardim-das-conquistas/assets/continua/trees/a/1.png';
    const result = await service.resolveAsset(url);
    expect(result).toBe(url);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('devolve URL https desconhecida intacta', async () => {
    const url = 'https://cdn.example.com/trees/a/1.png';
    const result = await service.resolveAsset(url);
    expect(result).toBe(url);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  describe('modo proxy (S3_ASSET_PROXY)', () => {
    beforeEach(() => {
      process.env.S3_ASSET_PROXY = 'true';
      process.env.PUBLIC_BASE_URL = 'https://api.example.com';
      service = new StorageService();
    });

    afterEach(() => {
      delete process.env.S3_ASSET_PROXY;
      delete process.env.PUBLIC_BASE_URL;
    });

    it('retorna URL same-origin em vez de pré-assinada', async () => {
      const result = await service.resolveAsset('assets/pontual/stars/a/1.png');
      expect(result).toBe('https://api.example.com/api/assets/assets/pontual/stars/a/1.png');
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });
  });
});
