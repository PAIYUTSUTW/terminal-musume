import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startBridge } from '../src/bridge.mjs';
import { loadPack } from '../src/pack.mjs';
import { TerminalBackground, parseSettings } from '../src/windows-terminal.mjs';
import { PROVIDERS, STATES } from '../src/constants.mjs';
import { eventually } from './helpers.mjs';

test('real hook subprocess → file queue → reply decision → native background URI → restoration', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'musume-end-to-end-'));
  const home = path.join(dir, 'runtime'), packRoot = path.join(dir, 'pack');
  let bridge, controller;
  try {
    const manifest = { version: 1, name: 'fixture', providers: {} };
    for (const provider of PROVIDERS) {
      await mkdir(path.join(packRoot, provider), { recursive: true }); manifest.providers[provider] = {};
      for (const state of STATES) {
        const name = `${provider}/${state}.gif`;
        await writeFile(path.join(packRoot, name), Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'));
        manifest.providers[provider][state] = name;
      }
    }
    await writeFile(path.join(packRoot, 'pack.json'), JSON.stringify(manifest));
    const settingsPath = path.join(dir, 'settings.json');
    await writeFile(settingsPath, '{"profiles":{"list":[{"guid":"target","name":"Ubuntu"}]}}');
    controller = await new TerminalBackground({ settingsPath, profile: 'target', home }).open();
    bridge = await startBridge({ home, pack: await loadPack(packRoot), background: controller, windowsPackRoot: 'C:\\avatar-pack', port: 0, demo: true });
    const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/emit-hook.mjs', import.meta.url)), '--provider', 'codex', '--home', home], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; });
    child.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: 'session-1', last_assistant_message: '全部測試通過，沒有錯誤。' }));
    assert.equal(await new Promise(resolve => child.on('exit', resolve)), 0);
    assert.deepEqual(JSON.parse(stdout), {});
    // The API observes in-memory state while the file pump is still awaiting
    // the settings write. Wait for the native side effect and queue removal too.
    const snapshot = await eventually(async () => {
      const [value, settings, queue] = await Promise.all([
        fetch(`${bridge.url}/api/state`).then(response => response.json()),
        readFile(settingsPath, 'utf8').then(parseSettings),
        readdir(path.join(home, 'inbox')),
      ]);
      return value.active.state === 'happy'
        && settings.profiles.list[0].backgroundImage === 'C:\\avatar-pack\\codex\\happy.gif'
        && queue.length === 0 && value;
    });
    assert.equal(snapshot.active.provider, 'codex'); assert.equal(snapshot.active.state, 'happy');
    assert.equal(parseSettings(await readFile(settingsPath, 'utf8')).profiles.list[0].backgroundImage, 'C:\\avatar-pack\\codex\\happy.gif');
    assert.deepEqual(await readdir(path.join(home, 'inbox')), []);
    assert.ok(!JSON.stringify(snapshot).includes('全部測試通過'));
    assert.equal((await fetch(`${bridge.url}/api/demo`, { method: 'POST', headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' }, body: '{"provider":"codex","state":"happy"}' })).status, 403);
    assert.equal((await fetch(`${bridge.url}/assets/codex/happy.gif`)).status, 200);
    await bridge.close(); bridge = null;
    assert.deepEqual(parseSettings(await readFile(settingsPath, 'utf8')).profiles.list[0], { guid: 'target', name: 'Ubuntu' });
  } finally { if (bridge) await bridge.close(); else if (controller) await controller.close(); await rm(dir, { recursive: true, force: true }); }
});
