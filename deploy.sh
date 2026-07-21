#!/bin/bash
set -e

echo "=== Deploy Voice Diary ==="

# Load secrets from config.env
if [ ! -f config.env ]; then
  echo "❌ config.env not found"
  exit 1
fi
set -a; source config.env; set +a
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_TOKEN"

# Non-secret vars + KV binding in wrangler.toml
cat > wrangler.toml <<EOF
name = "voice-diary"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "LOGS"
id = "${KV_NAMESPACE_ID}"

[vars]
USER_ID = "${USER_ID}"
GITHUB_REPO = "${GITHUB_REPO}"
GITHUB_BRANCH = "${GITHUB_BRANCH}"
EOF

echo "🚀 Desplegando..."
WORKER_URL=$(npx wrangler deploy 2>&1 | grep -oP 'https://[a-z0-9-]+\.workers\.dev' | head -1)
echo "Worker URL: ${WORKER_URL}"

echo "🔐 Subiendo secrets..."
echo "${TELEGRAM_TOKEN}" | npx wrangler secret put TELEGRAM_TOKEN
echo "${OPENAI_API_KEY}" | npx wrangler secret put OPENAI_API_KEY
echo "${GITHUB_TOKEN}" | npx wrangler secret put GITHUB_TOKEN

echo "🔗 Configurando webhook..."
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${WORKER_URL}" | python3 -m json.tool

echo "✅ Done"