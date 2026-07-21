function b64encode(str){const b=new TextEncoder().encode(str);let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s)}
function b64decode(b64){const s=atob(b64);const b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return new TextDecoder().decode(b)}

async function notify(env, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({chat_id: env.USER_ID, text})
  });
}

async function log(env, step, status, detail) {
  const ts = Date.now();
  const entry = JSON.stringify({ts, step, status, detail});
  await env.LOGS.put(`log:${ts}`, entry, {expirationTtl: 604800});
  console.log(`[${step}] ${status}: ${detail}`);
}

function dayName(date) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return days[date.getDay()];
}

function makeTemplate(date) {
  const pad = n => String(n).padStart(2, '0');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dn = dayName(date);
  const mn = months[date.getMonth()];
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const yd = new Date(date); yd.setDate(yd.getDate()-1);
  const td = new Date(date); td.setDate(td.getDate()+1);
  const ys = `${yd.getFullYear()}-${pad(yd.getMonth()+1)}-${pad(yd.getDate())}-${dayName(yd)}`;
  const ts = `${td.getFullYear()}-${pad(td.getMonth()+1)}-${pad(td.getDate())}-${dayName(td)}`;
  const utc = new Date(Date.UTC(y, m, d));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const yStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const wn = Math.ceil((((utc - yStart) / 86400000) + 1) / 7);
  const ws = `${y}-W${pad(wn)}`;
  const ds = `${y}-${pad(m+1)}-${pad(d)}`;
  return `---
tags:
  - "#type/daily-note"
cssclasses:
  - daily
  - ${dn.toLowerCase()}
banner: 99 - Meta/Templates/Diary/Daily Notes/${dn}Banner.avif
banner-x: 30
banner-y: 30
banner-display: cover
banner-height: 400
banner-fade: -75
date: ${ds}
---
# ✧ ${dn}, ${mn} ${d}, ${y}

← [[05 - Diary/daily/${ys}|Yesterday]] · [[05 - Diary/weekly/${ws}|Week]] · [[05 - Diary/daily/${ts}|Tomorrow]] →

## 📝 Log
-

## 💡 Ideas
-

## 📸 Fotos
-`;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    let body;
    try {
      body = await request.json();
    } catch (e) {
      await log(env, "parse", "error", e.message);
      return new Response("OK");
    }

    const msg = body.message;
    if (!msg?.voice || msg.from.id != env.USER_ID) return new Response("OK");

    await notify(env, "🎙️ Nota de voz recibida, procesando...");
    await log(env, "start", "ok", "voice message received");

    // STEP 1: Download from Telegram
    let audio;
    try {
      const d1 = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getFile?file_id=${msg.voice.file_id}`)).json();
      if (!d1.ok) throw new Error(`Telegram getFile: ${d1.description}`);
      const audioRes = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${d1.result.file_path}`);
      if (!audioRes.ok) throw new Error(`Telegram download: ${audioRes.status}`);
      audio = await audioRes.arrayBuffer();
      await log(env, "telegram-download", "ok", `${audio.byteLength} bytes`);
    } catch (e) {
      await log(env, "telegram-download", "error", e.message);
      await notify(env, `❌ Falló descarga de Telegram: ${e.message}`);
      return new Response("OK");
    }

    // STEP 2: Whisper transcription
    let text;
    try {
      const fd = new FormData();
      fd.append("file", new Blob([audio], {type: "audio/ogg"}), "voice.ogg");
      fd.append("model", "whisper-1");
      fd.append("language", "es");
      fd.append("response_format", "text");
      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST", headers: {Authorization: `Bearer ${env.OPENAI_API_KEY}`}, body: fd
      });
      text = await whisperRes.text();
      if (!whisperRes.ok) throw new Error(`OpenAI ${whisperRes.status}: ${text.substring(0, 200)}`);
      await log(env, "whisper", "ok", text.substring(0, 80));
    } catch (e) {
      await log(env, "whisper", "error", e.message);
      await notify(env, `❌ Falló transcripción OpenAI: ${e.message}`);
      return new Response("OK");
    }

    // STEP 3: Push to GitHub
    try {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const d = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
      const dn = dayName(now);
      const t = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const path = `05 - Diary/daily/${d}-${dn}.md`;
      const gh = (url, opts = {}) => fetch(url, {...opts, headers: {Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json", "User-Agent": "voice-diary-worker", ...opts.headers}});

      let content, sha;
      const ex = await gh(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`);
      if (ex.ok) {
        const x = await ex.json();
        content = b64decode(x.content);
        sha = x.sha;
        const entry = `- 🎙️ **${t}** — ${text}`;
        const logIdx = content.indexOf("## 📝 Log");
        const ideasIdx = content.indexOf("## 💡 Ideas");
        if (logIdx !== -1 && ideasIdx !== -1) {
          const insertPos = ideasIdx;
          content = content.slice(0, insertPos) + entry + "\n" + content.slice(insertPos);
        } else if (logIdx !== -1) {
          content = content + "\n" + entry;
        } else {
          content += `\n${entry}\n`;
        }
      } else {
        content = makeTemplate(now);
        const entry = `- 🎙️ **${t}** — ${text}`;
        content = content.replace("## 💡 Ideas", entry + "\n## 💡 Ideas");
      }

      const putBody = JSON.stringify({message: `voice: ${d} ${t}`, content: b64encode(content), branch: env.GITHUB_BRANCH, sha});
      const putRes = await gh(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`, {method: "PUT", headers: {"Content-Type": "application/json"}, body: putBody});
      const putText = await putRes.text();
      let putData;
      try { putData = JSON.parse(putText); } catch { putData = {message: putText.substring(0, 200)}; }
      if (!putRes.ok) throw new Error(`GitHub ${putRes.status}: ${putData.message ?? putText.substring(0, 200)}`);
      await log(env, "github-push", "ok", `commit ${putData.commit?.sha?.substring(0, 8)}`);
      await notify(env, `✅ Audio guardado en daily ${d} con el contenido: ${text}`);
    } catch (e) {
      await log(env, "github-push", "error", e.message);
      await notify(env, `❌ Falló push a GitHub: ${e.message}`);
      return new Response("OK");
    }

    return new Response("OK");
  }
}