import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { MultiTerminal } from '../src/multi-terminal.mjs';
import { startController } from '../src/controller.mjs';
import { loadPack } from '../src/pack.mjs';
export const project = fileURLToPath(new URL('../', import.meta.url));
export async function eventually(fn, { timeout = 6000 } = {}) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await delay(40); }
  throw last ?? new Error('Timed out waiting for state.');
}
export async function fixture(fn, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'musume-v2-'));
  const home = path.join(dir, 'runtime'), settingsPath = path.join(dir, 'settings.json');
  const original = { defaultProfile: '{base}', profiles: { list: [{ guid: '{base}', name: 'Ubuntu', commandline: 'wsl.exe' }] }, theme: 'dark' };
  await writeFile(settingsPath, JSON.stringify(original));
  const writer = await new MultiTerminal({ settingsPath, home }).open();
  let service;
  try {
    service = await startController({ home, writer, pack: await loadPack(path.join(project, 'assets/demo')), windowsPackRoot: 'C:\\musume', tickMs: 30, ...options });
    await fn({ dir, home, settingsPath, original, writer, service });
  } finally { if (service) await service.close(); else await writer.close(); await rm(dir, { recursive: true, force: true }); }
}
