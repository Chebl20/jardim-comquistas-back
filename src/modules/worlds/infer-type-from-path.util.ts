// Infer type ("continua", "pontual", etc) a partir do caminho logo após /assets/
export function inferTypeFromPath(path: string): string {
  if (!path) return 'desconhecido';
  // Remove prefixo / ou assets/ se houver
  let p = path.replace(/^\/+/, '');
  if (p.startsWith('assets/')) p = p.slice(7);
  const segs = p.split('/');
  if (segs.length > 0 && segs[0]) return segs[0];
  return 'desconhecido';
}
