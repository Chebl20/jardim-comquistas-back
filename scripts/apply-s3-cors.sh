#!/usr/bin/env bash
# Aplica CORS no bucket Garage/MinIO para o frontend carregar assets via Pixi.
#
# Pré-requisitos: mc (MinIO Client) instalado
#   curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o mc && chmod +x mc
#
# Variáveis (.env ou ambiente):
#   S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET
#   CORS_ALLOWED_ORIGINS — vírgula-separado ou * para todas as origens, ex:
#     https://app.coolify.chebl.cloud,http://localhost:5173
#     *

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

ENDPOINT="${S3_ENDPOINT:?S3_ENDPOINT não definido}"
ACCESS_KEY="${S3_ACCESS_KEY:?S3_ACCESS_KEY não definido}"
SECRET_KEY="${S3_SECRET_KEY:?S3_SECRET_KEY não definido}"
BUCKET="${S3_BUCKET:-jardim-das-conquistas}"
ALIAS="${S3_MC_ALIAS:-garage}"
ORIGINS="${CORS_ALLOWED_ORIGINS:-http://localhost:5173}"
ORIGINS="$(echo "$ORIGINS" | tr -d '[:space:]')"

if [[ "$ORIGINS" == "*" ]]; then
  ORIGIN_JSON='["*"]'
  ORIGIN_ARR=("*")
else
  IFS=',' read -r -a ORIGIN_ARR <<< "$ORIGINS"
  ORIGIN_JSON="$(printf '"%s",' "${ORIGIN_ARR[@]}")"
  ORIGIN_JSON="[${ORIGIN_JSON%,}]"
fi

CORS_FILE="$(mktemp)"
trap 'rm -f "$CORS_FILE"' EXIT

cat > "$CORS_FILE" <<EOF
[
  {
    "AllowedOrigins": ${ORIGIN_JSON},
    "AllowedMethods": ["GET", "HEAD", "OPTIONS"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
EOF

echo "Aplicando CORS em $ALIAS/$BUCKET"
if [[ "$ORIGINS" == "*" ]]; then
  echo "Origens: * (todas liberadas)"
else
  echo "Origens: $ORIGINS"
fi
echo "Config:"
cat "$CORS_FILE"

if ! command -v mc >/dev/null 2>&1; then
  echo
  echo "ERROR: 'mc' não encontrado. Instale o MinIO Client ou aplique manualmente:"
  echo "  mc alias set $ALIAS $ENDPOINT \$S3_ACCESS_KEY \$S3_SECRET_KEY"
  echo "  mc cors set $ALIAS/$BUCKET $CORS_FILE"
  exit 1
fi

mc alias set "$ALIAS" "$ENDPOINT" "$ACCESS_KEY" "$SECRET_KEY" >/dev/null
mc cors set "$ALIAS/$BUCKET" "$CORS_FILE"
mc cors info "$ALIAS/$BUCKET"

echo
echo "CORS aplicado. Valide com:"
echo "  ./scripts/check-s3-cors.sh \"$ORIGIN_ARR\""
