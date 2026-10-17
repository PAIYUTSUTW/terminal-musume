import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { MultiTerminal } from '../src/multi-terminal.mjs';
import { parseSettings, TerminalBackground } from '../src/windows-terminal.mjs';

const raw = '\uFEFF{\r\n  // keep me\r\n  "defaultProfile":"{base}",\r\n  "profiles":{"defaults":{"font":{"size":14}},"list":[{"guid":"{base}","name":"Ubuntu","commandline":"wsl.exe","font":{"size":13}}]},\r\n  "theme":"dark"\r\n}\r\n';
async function fixture(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'musume-multi-'));
  const settingsPath = path.join(dir, 'settings.json'), home = path.join(dir, 'runtime');
  await writeFile(settingsPath, raw);
  const writer = await new MultiTerminal({ settingsPath, home }).open();
  try { await fn({ writer, settingsPath, home, dir }); }
  finally { await writer.close(); await rm(dir, { recursive: true, force: true }); }
}
test('one writer creates and concurrently updates independent profiles, preserving JSONC and original profiles', async () => fixture(async ({ writer, settingsPath, home }) => {
  const a = await writer.create({ name: 'A', commandline: 'a.exe' });
  const b = await writer.create({ name: 'B', commandline: 'b.exe' });
  await Promise.all([writer.applyBatch([{ profile: a.guid, image: 'C:\\claude.gif' }]), writer.applyBatch([{ profile: b.guid, image: 'C:\\codex.gif' }])]);
  const current = await readFile(settingsPath, 'utf8');
  const data = parseSettings(current);
  assert.equal(data.profiles.list[1].backgroundImage, 'C:\\claude.gif');
  assert.equal(data.profiles.list[2].backgroundImage, 'C:\\codex.gif');
  assert.deepEqual(data.profiles.list[0], parseSettings(raw).profiles.list[0]);
  assert.ok(current.startsWith('\uFEFF')); assert.ok(current.includes('// keep me\r\n'));
  await assert.rejects(new TerminalBackground({ settingsPath, home, profile: '{base}' }).open(), /Another Terminal Musume/);
  await writer.close(); assert.deepEqual(parseSettings(await readFile(settingsPath, 'utf8')), parseSettings(raw));
}));
test('manual edits to a managed profile or unrelated setting survive cleanup', async () => fixture(async ({ writer, settingsPath }) => {
  const a = await writer.create({ name: 'A', commandline: 'a.exe' });
  const b = await writer.create({ name: 'B', commandline: 'b.exe' });
  const data = parseSettings(await readFile(settingsPath, 'utf8'));
  data.theme = 'light'; data.profiles.list.find(p => p.guid === a.guid).name = 'User renamed';
  await writeFile(settingsPath, JSON.stringify(data));
  await writer.close();
  const next = parseSettings(await readFile(settingsPath, 'utf8'));
  assert.equal(next.theme, 'light'); assert.equal(next.profiles.list.find(p => p.guid === a.guid).name, 'User renamed');
  assert.ok(!next.profiles.list.some(p => p.guid === b.guid)); assert.deepEqual(writer.preserved, [a.guid]);
}));
test('an invalid batch cannot poison later successful background updates', async () => fixture(async ({ writer, settingsPath }) => {
  const a = await writer.create({ name: 'A', commandline: 'a.exe' });
  await assert.rejects(writer.applyBatch([{ profile: a.guid, image: 'C:\\happy.gif' }, { profile: 'foreign', image: 'C:\\wrong.gif' }]), /managed/);
  await writer.applyBatch([{ profile: a.guid, image: 'C:\\happy.gif' }]);
  assert.equal(parseSettings(await readFile(settingsPath, 'utf8')).profiles.list.find(p => p.guid === a.guid).backgroundImage, 'C:\\happy.gif');
}));
test('a killed writer recovers its journal without deleting pre-existing profiles', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'musume-crash-'));
  const settingsPath = path.join(dir, 'settings.json'), home = path.join(dir, 'runtime');
  await writeFile(settingsPath, raw);
  const moduleURL = new URL('../src/multi-terminal.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {MultiTerminal} from ${JSON.stringify(moduleURL)}; const writer=await new MultiTerminal(${JSON.stringify({ settingsPath, home })}).open(); await writer.create({name:'crash',commandline:'cmd.exe'}); process.stdout.write('ready\\n'); setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('child exited early'))); });
    child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve));
    const writer = await new MultiTerminal({ settingsPath, home }).open();
    assert.deepEqual(parseSettings(await readFile(settingsPath, 'utf8')), parseSettings(raw));
    await writer.close();
  } finally { child.kill('SIGKILL'); await rm(dir, { recursive: true, force: true }); }
});
