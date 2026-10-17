import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { SessionRouter } from './routing.mjs';
import { atomicWrite, readJSON } from './io.mjs';
import { toWindowsAssetPath } from './windows-terminal.mjs';
import { classifyWithLocalModel } from './classify.mjs';

export const isAlive = pid => {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

export async function startController({ home, writer, pack, port = 0, windowsPackRoot, opacity = .38, reactionMs = 6000, ollamaModel, onClose, tickMs = 150 }) {
  home = path.resolve(home);
  const inbox = path.join(home, 'inbox');
  await mkdir(inbox, { recursive: true, mode: 0o700 });
  const router = new SessionRouter({ reactionMs });
  const configPath = path.join(home, 'controller.json');
  const token = randomBytes(32).toString('hex');
  const tmuxBindings = new Map();
  let tail = Promise.resolve(), closing = false, timer, tmuxObserver, lastError = null;
  const exclusive = fn => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
  const snapshot = () => ({ ...router.snapshot(), pid: process.pid, tmux: [...tmuxBindings.values()].map(row => ({ target: row.target, server: row.server, clientPid: row.clientPid })), lastError, preservedProfiles: writer.preserved ?? [] });
  async function publish() {
    const updates = router.snapshot().targets.map(target => ({ profile: target.profile, image: toWindowsAssetPath(pack.providers[target.provider][target.state].file, { packRoot: pack.root, windowsRoot: windowsPackRoot }), opacity }));
    await writer.applyBatch(updates);
  }
  async function removeTarget(id) {
    const target = router.targets.get(id);
    if (!target) return false;
    tmuxBindings.delete(id);
    await writer.remove(target.profile);
    router.removeTarget(id);
    await unlink(path.join(home, 'targets', `${id}.json`)).catch(() => {});
    return true;
  }
  const methods = {
    status: async () => snapshot(),
    async createTarget({ id = randomUUID(), name = 'Terminal Musume', provider = 'claude', commandline, launch = {}, appearance = {} }) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !['claude', 'codex'].includes(provider) || typeof commandline !== 'string' || !commandline) throw new Error('Invalid display target.');
      const profile = await writer.create({ ...appearance, guid: `{${randomUUID()}}`, name, commandline, tabTitle: name, suppressApplicationTitle: true });
      router.addTarget({ id, profile: profile.guid, provider, createdAt: Date.now(), pid: null });
      try {
        await atomicWrite(path.join(home, 'targets', `${id}.json`), JSON.stringify({ id, profile: profile.guid, home, launch }));
        await publish();
      } catch (error) { await removeTarget(id); throw error; }
      return { id, profile: profile.guid };
    },
    async claimTarget({ id, pid, wtSession }) {
      const target = router.targets.get(id);
      if (!target || !isAlive(pid)) throw new Error('Display target is unavailable.');
      if (target.pid && target.pid !== pid && isAlive(target.pid)) throw new Error('This profile is already open. Use musume open to create an independent tab.');
      Object.assign(target, { pid, wtSession }); return { id, terminal: target.terminal };
    },
    async closeTarget({ id }) { return { removed: await removeTarget(id) }; },
    async beginRun(input) {
      if (!isAlive(input.pid)) throw new Error('Agent wrapper is not running.');
      if (input.location?.kind === 'direct' && ![...router.targets.values()].some(row => row.terminal === input.location.terminal && row.pid)) throw new Error('Open a managed Terminal tab first with musume open.');
      const run = router.beginRun({ ...input, at: Date.now() }); await publish(); return { run };
    },
    async endRun({ run }) { router.endRun(run); await publish(); return { ended: true }; },
    // The tmux adapter is installed by TM-005. RPC validates availability here.
    async bindTmux(input) {
      if (!tmuxObserver) throw new Error('tmux adapter is not enabled.');
      if (!router.targets.has(input.target) || !isAlive(input.clientPid)) throw new Error('Invalid tmux client binding.');
      await tmuxObserver.validate(input);
      tmuxBindings.set(input.target, { ...input });
      router.setView(input.target, null); await tmuxObserver.refresh(); await publish(); return { bound: true };
    },
    async unbindTmux({ target, clientPid }) {
      if (tmuxBindings.get(target)?.clientPid === clientPid) { tmuxBindings.delete(target); router.directView(target); await publish(); }
      return { unbound: true };
    },
    async stop() { setImmediate(() => close().catch(error => { lastError = error.message; })); return { stopping: true }; },
  };
  async function pump() {
    if (closing) return;
    const files = (await readdir(inbox)).filter(file => /^\d+-[a-z0-9-]+\.json$/.test(file)).sort().slice(0, 256);
    for (const name of files) {
      const file = path.join(inbox, name);
      try {
        if ((await stat(file)).size > 128 * 1024) throw new Error('Event exceeds size limit.');
        const event = JSON.parse(await readFile(file, 'utf8'));
        const decision = event.kind === 'reply' && ollamaModel ? await classifyWithLocalModel(event.text, { model: ollamaModel }) : undefined;
        router.accept(event, Date.now(), decision);
      } catch (error) { lastError = `Skipped event: ${error.message}`; }
      finally { await unlink(file).catch(() => {}); }
    }
    for (const [id, target] of router.targets) {
      if (target.pid ? !isAlive(target.pid) : Date.now() - target.createdAt > 60_000) await removeTarget(id);
    }
    for (const run of router.runs.values()) if (!run.ended && !isAlive(run.pid)) router.endRun(run.run);
    if (tmuxObserver) await tmuxObserver.refresh();
    await publish();
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
    try {
      const expected = Buffer.from(`Bearer ${token}`), supplied = Buffer.from(request.headers.authorization ?? '');
      if (request.headers.origin || request.headers.host !== `127.0.0.1:${server.address().port}` || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        response.writeHead(403); response.end(JSON.stringify({ error: 'Local controller authentication required.' })); return;
      }
      if (closing || request.method !== 'POST' || request.url !== '/rpc' || !(request.headers['content-type'] ?? '').startsWith('application/json')) throw new Error('Invalid controller request.');
      let body = '';
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 64 * 1024) throw new Error('Request too large.'); }
      const { method, params } = JSON.parse(body);
      if (!Object.hasOwn(methods, method)) throw new Error('Unknown controller method.');
      const value = await exclusive(() => methods[method](params ?? {}));
      response.end(JSON.stringify(value));
    } catch (error) { response.writeHead(400); response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  await atomicWrite(configPath, JSON.stringify({ pid: process.pid, url, token, settingsPath: writer.settingsPath }));
  let ticking = false;
  timer = setInterval(() => {
    if (closing || ticking) return;
    ticking = true;
    exclusive(pump).catch(error => { lastError = error.message; }).finally(() => { ticking = false; });
  }, tickMs);
  async function close() {
    if (closing) return;
    closing = true; clearInterval(timer); await tail;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    try { await writer.close(); }
    finally {
      const current = await readJSON(configPath, null);
      if (current?.token === token) await unlink(configPath).catch(() => {});
      await onClose?.();
    }
  }
  return { router, url, close, methods, snapshot, publish: () => exclusive(publish),
    setTmuxObserver(observer) { tmuxObserver = observer; observer.bindings = tmuxBindings; },
    async tick() { return exclusive(pump); } };
}
