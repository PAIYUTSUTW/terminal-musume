import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.mjs';
import { callController } from '../src/rpc.mjs';
import { parseSettings } from '../src/windows-terminal.mjs';

test('authenticated controller registers isolated displays and restores their profiles', () => fixture(async ({ home, service, settingsPath, original }) => {
  const a = await callController(home, 'createTarget', { id: 'A', name: 'A', commandline: 'cmd.exe' });
  const b = await callController(home, 'createTarget', { id: 'B', name: 'B', commandline: 'cmd.exe', provider: 'codex' });
  assert.notEqual(a.profile, b.profile);
  await callController(home, 'claimTarget', { id: 'A', pid: process.pid, wtSession: 'native-A' });
  const status = await callController(home, 'status');
  assert.equal(status.targets.length, 2); assert.equal(status.targets.find(t => t.target === 'B').provider, 'codex');
  await callController(home, 'closeTarget', { id: 'A' });
  assert.equal((await callController(home, 'status')).targets.length, 1);
  await service.close(); assert.deepEqual(parseSettings(await readFile(settingsPath, 'utf8')), original);
}));
test('controller denies missing auth, browser origins and unknown RPC methods', () => fixture(async ({ home, service }) => {
  const config = JSON.parse(await readFile(path.join(home, 'controller.json'), 'utf8'));
  for (const headers of [{}, { Authorization: `Bearer ${config.token}`, Origin: service.url }]) {
    const response = await fetch(`${service.url}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{"method":"status"}' });
    assert.equal(response.status, 403);
  }
  await assert.rejects(callController(home, 'unknown'), /Unknown/);
  await assert.rejects(callController(home, 'beginRun', { provider: 'codex', run: 'r', pid: process.pid, location: { kind: 'direct', terminal: 'unregistered' } }), /managed/);
}));
