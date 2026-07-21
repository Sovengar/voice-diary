# Voice Diary

Cloudflare Worker que recibe notas de voz de Telegram, las transcribe con Whisper (OpenAI), y las guarda como entradas en daily notes de Obsidian (en GitHub).

## Dominio

`https://voice-diary.<your-subdomain>.workers.dev`

## Workflow end-to-end

```
Tú → Telegram (nota de voz) → Cloudflare Worker → OpenAI Whisper → GitHub API → Obsidian Git (pull)
```

1. **Tú** mandas una nota de voz al bot de Telegram
2. **Telegram** envía el audio al worker via webhook POST
3. **Worker** valida que eres tú (`USER_ID`), descarga el archivo de Telegram
4. **OpenAI Whisper** transcribe el audio a texto (modelo `whisper-1`, $0.006/min)
5. **GitHub API** recibe el texto: si el daily note existe, añade la entrada al final de `## 📝 Log`; si no existe, crea el archivo con el template completo (frontmatter, banner, secciones)
6. **Worker** te confirma en Telegram: `✅ Audio guardado en daily YYYY-MM-DD con el contenido: <texto>`
7. **Obsidian Git plugin** hace pull automático del repo a tu vault local

## Participantes y roles

| Componente | Rol | Detalle |
|---|---|---|
| **Tú** | Usuario | Mandas notas de voz al bot desde el móvil |
| **Telegram Bot** | Transporte | Recibe el audio y lo reenvía al worker via webhook |
| **Cloudflare Worker** | Orquestador | Valida identidad, descarga audio, llama a Whisper, hace push a GitHub, notifica a Telegram |
| **OpenAI Whisper** | Transcripción | Convierte audio OGG a texto en español (`whisper-1`) |
| **GitHub API** | Almacenamiento | Guarda el daily note en `05 - Diary/daily/YYYY-MM-DD-DayName.md`, branch `dev` |
| **Obsidian Git** | Sincronización | Pull automático del repo a tu vault local |
| **Cloudflare KV** | Logging | Guarda logs de cada ejecución (TTL 7 días) |

## Código

### `src/index.js` — Worker

3 pasos con try-catch y notificación de errores en cada uno:

- **STEP 1**: Descarga audio de Telegram (`getFile` + `file/bot/`)
- **STEP 2**: Envía a Whisper (`/v1/audio/transcriptions`, modelo `whisper-1`, idioma `es`)
- **STEP 3**: Push a GitHub:
  - Si el daily note existe → añade `- 🎙️ **HH:mm** — texto` antes de `## 💡 Ideas`
  - Si no existe → crea el archivo con el template (frontmatter, banner, Yesterday/Week/Tomorrow links, secciones Log/Ideas/Fotos)
- Logs guardados en KV (`log:{timestamp}`, TTL 7 días)

### `config.env` — Variables (user-filled)

- `TELEGRAM_TOKEN`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `CLOUDFLARE_TOKEN` (secrets)
- `USER_ID`, `GITHUB_REPO`, `GITHUB_BRANCH` (non-secret vars)

### `deploy.sh` — Script de deploy

1. Lee `config.env`
2. Regenera `wrangler.toml` (vars + KV binding)
3. Ejecuta `wrangler deploy`
4. Sube los 3 tokens como **secrets** (encriptados, no visibles en dashboard)
5. Configura el webhook de Telegram

## Seguridad

- Tokens encriptados como Cloudflare **secrets** (no texto plano)
- `USER_ID` filtra mensajes que no sean tuyos
- GitHub fine-grained PAT con Contents read+write, solo repo `Sovengar/obsidian-vault`
- OpenAI spending limit configurable ($5/mes recomendado)
- Repo privado, markdown-only (attachments excluidos via `.gitignore`)

## Coste

| Servicio | Coste |
|---|---|
| **Cloudflare Worker** | Free tier (100k req/día) |
| **OpenAI Whisper** | $0.006/min de audio (~166 min por 1€) |
| **GitHub** | Free (repo privado) |
| **Telegram Bot** | Gratis |
| **Cloudflare KV** | Free tier (100k reads, 1k writes/día) |