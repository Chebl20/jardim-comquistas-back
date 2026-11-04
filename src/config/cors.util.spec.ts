import { resolveCorsOrigin } from './cors.util';

describe('resolveCorsOrigin', () => {
  it('allows all when unset or empty', () => {
    expect(resolveCorsOrigin(undefined)).toBe(true);
    expect(resolveCorsOrigin('')).toBe(true);
    expect(resolveCorsOrigin('  ,  ')).toBe(true);
  });

  it('allows all when * is present', () => {
    expect(resolveCorsOrigin('*')).toBe(true);
    expect(resolveCorsOrigin('*,http://localhost:5173')).toBe(true);
  });

  it('returns explicit origins otherwise', () => {
    expect(resolveCorsOrigin('https://jardim.chebl.cloud')).toEqual([
      'https://jardim.chebl.cloud',
    ]);
    expect(
      resolveCorsOrigin(
        'https://jardim.chebl.cloud, http://localhost:5173',
      ),
    ).toEqual(['https://jardim.chebl.cloud', 'http://localhost:5173']);
  });
});
