import { createServer } from 'node:http';
import { readdir, readFile, unlink, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AvatarState } from './state.mjs';
import { normalizeHook } from './events.mjs';
import { classifyWithLocalModel } from './classify.mjs';
import { STATES, LABELS, PROVIDERS } from './constants.mjs';
import { toWindowsAssetPath } from './windows-terminal.mjs';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.gif': 'image/gif', '.ttf': 'font/ttf' };
const PUBLIC_FILES = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/fonts/noto-sans-tc-subset.ttf': 'fonts/noto-sans-tc-subset.ttf' };

export async function startBridge({ home, pack, background, port = 7331, demo = false, opacity = .28, windowsPackRoot, ollamaModel, ollamaURL, reactionMs = 6000 }) {
  const machine = new AvatarState({ reactionMs });
  const clients = new Set();
  let pumping = false, lastVisual = '', lastPublished = '', stopping = false;
  const inbox = path.join(home, 'inbox');
  await mkdir(inbox, { recursive: true, mode: 0o700 });
  const snapshot = () => ({ ...machine.snapshot(), labels: LABELS, demo,
    pack: { name: pack.manifest.name, sourceKind: pack.manifest.sourceKind ?? 'custom',
      animations: Object.fromEntries(PROVIDERS.map(provider => [provider, Object.fromEntries(STATES.map(state => [state, `/assets/${pack.providers[provider][state].relative.split('/').map(encodeURIComponent).join('/')}`]))])) },
    background: { attached: Boolean(background), opacity } });
  async function publish() {
    const value = snapshot();
    const key = `${value.active.provider}:${value.active.state}`;
    if (key !== lastVisual && background) {
      const asset = pack.providers[value.active.provider][value.active.state];
      await background.apply(toWindowsAssetPath(asset.file, { packRoot: pack.root, windowsRoot: windowsPackRoot }), { opacity });
    }
    lastVisual = key;
    const data = JSON.stringify(value);
    if (data !== lastPublished) { for (const response of clients) response.write(`data: ${data}\n\n`); lastPublished = data; }
    return value;
  }
  async function accept(event) {
    const decision = event.kind === 'reply' && ollamaModel ? await classifyWithLocalModel(event.text, { model: ollamaModel, baseURL: ollamaURL }) : undefined;
    machine.apply(event, Date.now(), decision);
    return publish();
  }
  async function pump() {
    if (pumping || stopping) return;
    pumping = true;
    try {
      const files = (await readdir(inbox)).filter(name => /^\d+-[a-z0-9-]+\.json$/.test(name)).sort().slice(0, 128);
      for (const name of files) {
        const file = path.join(inbox, name);
        try {
          if ((await stat(file)).size > 128 * 1024) throw new Error('Event exceeds size limit.');
          const event = JSON.parse(await readFile(file, 'utf8'));
          await accept(event);
        } catch (error) {
          // No raw reply, path, tool output, or prompt is logged.
          process.stderr.write(`Terminal Musume event skipped: ${error.message}\n`);
        } finally { await unlink(file).catch(() => {}); }
      }
      await publish();
    } catch (error) { process.stderr.write(`Terminal Musume: ${error.message}\n`); }
    finally { pumping = false; }
  }
  async function requestJSON(request) {
    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) throw new Error('Use application/json.');
    let text = '';
    for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > 32 * 1024) throw new Error('Request too large.'); }
    return JSON.parse(text);
  }
  const server = createServer(async (request, response) => {
    try {
      const allowedHost = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== allowedHost || (request.headers.origin && request.headers.origin !== `http://${allowedHost}`)) {
        response.writeHead(403); response.end('Local preview only.'); return;
      }
      const url = new URL(request.url, `http://${allowedHost}`);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'");
      if (request.method === 'GET' && url.pathname === '/api/state') {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(snapshot())); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        response.write(`data: ${JSON.stringify(snapshot())}\n\n`); clients.add(response);
        request.on('close', () => clients.delete(response)); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/demo' && demo) {
        const body = await requestJSON(request);
        if (!PROVIDERS.includes(body.provider)) throw new Error('Choose an agent.');
        let event;
        if (body.text !== undefined) event = normalizeHook(body.provider, { hook_event_name: 'Stop', session_id: 'preview', last_assistant_message: String(body.text) });
        else {
          if (!STATES.includes(body.state)) throw new Error('Choose an animation.');
          const examples = { idle: ['SessionStart', ''], thinking: ['UserPromptSubmit', ''], working: ['PreToolUse', ''], waiting: ['PermissionRequest', ''], happy: ['Stop', '全部測試通過，已完成修復。'], concerned: ['Stop', '目前還有兩個測試失敗，尚未修復。'], explaining: ['Stop', '這個函式會先驗證輸入，接著更新畫面。'] };
          const [name, text] = examples[body.state];
          event = normalizeHook(body.provider, { hook_event_name: name, session_id: 'preview', last_assistant_message: text });
        }
        const result = await accept(event);
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result)); return;
      }
      if (request.method !== 'GET') { response.writeHead(404); response.end(); return; }
      let file;
      if (url.pathname.startsWith('/assets/')) {
        const relative = decodeURIComponent(url.pathname.slice(8));
        const slot = Object.values(pack.providers).flatMap(slots => Object.values(slots)).find(asset => asset.relative === relative);
        if (slot) file = slot.file;
      } else file = Object.hasOwn(PUBLIC_FILES, url.pathname) ? path.join(WEB, PUBLIC_FILES[url.pathname]) : undefined;
      if (!file) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch (error) { if (!response.headersSent) response.writeHead(400); response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  try { await publish(); } catch (error) { server.close(); throw error; }
  const timer = setInterval(pump, 200);
  const heartbeat = setInterval(() => { for (const response of clients) response.write(': heartbeat\n\n'); }, 15_000);
  return { server, machine, url: `http://127.0.0.1:${server.address().port}`, async close() {
    stopping = true; clearInterval(timer); clearInterval(heartbeat);
    for (const response of clients) response.end();
    // Drain an in-flight file pump before restoring the terminal appearance.
    while (pumping) await new Promise(resolve => setTimeout(resolve, 20));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (background) await background.close();
  } };
}
