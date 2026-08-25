#!/usr/bin/env bash
# Simula o fetch cross-origin do browser (Pixi) contra uma URL pré-assinada do S3/Garage.
# Uso: ./scripts/check-s3-cors.sh [ORIGIN] [PRESIGNED_URL]
#   ORIGIN          default: http://localhost:5173
#   PRESIGNED_URL   opcional; se omitido, gera uma via Node usando .env

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORIGIN="${1:-http://localhost:5173}"
PRESIGNED_URL="${2:-}"

if [[ -z "$PRESIGNED_URL" ]]; then
  if [[ ! -f "$ROOT/.env" ]]; then
    echo "ERROR: informe PRESIGNED_URL ou crie .env com S3_*" >&2
    exit 1
  fi
  PRESIGNED_URL="$(node -e "
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join('$ROOT', '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split(/\\r?\\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const k = trimmed.slice(0, eq).trim();
        let v = trimmed.slice(eq + 1).trim();
        if ((v.startsWith('\"') && v.endsWith('\"')) || (v.startsWith(\"'\") && v.endsWith(\"'\"))) {
          v = v.slice(1, -1);
        }
        if (!process.env[k]) process.env[k] = v;
      }
    }
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const bucket = process.env.S3_BUCKET;
    const key = process.env.S3_CORS_TEST_KEY || 'assets/pontual/stars/a/1.png';
    if (!bucket || !process.env.S3_ENDPOINT) {
      console.error('S3_BUCKET e S3_ENDPOINT são obrigatórios');
      process.exit(1);
    }
    const client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'garage',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
      forcePathStyle: true,
    });
    getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 })
      .then((u) => process.stdout.write(u))
      .catch((e) => { console.error(e.message); process.exit(1); });
  ")"
fi

echo "=== Diagnóstico CORS S3/Garage ==="
echo "Origin simulada: $ORIGIN"
echo "URL testada:     ${PRESIGNED_URL:0:80}..."
echo

echo "--- GET com header Origin (como Pixi/fetch) ---"
GET_HEADERS="$(curl -sS -D - -o /dev/null \
  -H "Origin: $ORIGIN" \
  "$PRESIGNED_URL" || true)"
echo "$GET_HEADERS" | head -20

ACAO="$(echo "$GET_HEADERS" | grep -i '^access-control-allow-origin:' | tr -d '\r' || true)"
HTTP_STATUS="$(echo "$GET_HEADERS" | grep -E '^HTTP/' | tail -1 | awk '{print $2}')"

echo
echo "--- OPTIONS preflight (se aplicável) ---"
OPT_HEADERS="$(curl -sS -D - -o /dev/null -X OPTIONS \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  "${PRESIGNED_URL%%\?*}" 2>/dev/null || true)"
echo "$OPT_HEADERS" | head -15

echo
echo "=== Resultado ==="
echo "HTTP status GET: $HTTP_STATUS"
if [[ -n "$ACAO" ]]; then
  echo "CORS OK: $ACAO"
  echo "Pixi deve carregar direto do S3 com esta origem."
  exit 0
fi

if [[ "$HTTP_STATUS" == "200" ]]; then
  echo "PROBLEMA: GET retorna 200 mas sem Access-Control-Allow-Origin."
  echo "Causa provável: CORS não configurado no bucket Garage/MinIO."
  echo "Correção: ./scripts/apply-s3-cors.sh"
  echo "Alternativa: S3_ASSET_PROXY=true no backend (URLs same-origin via /api/assets/...)"
  exit 1
fi

echo "GET falhou com status $HTTP_STATUS — verifique assinatura, objeto ou endpoint."
exit 1
