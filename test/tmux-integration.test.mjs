import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixture, eventually, project } from './helpers.mjs';
import { TmuxObserver, tmuxClients } from '../src/tmux.mjs';
import { callController } from '../src/rpc.mjs';
import { normalizeHook } from '../src/events.mjs';
import { enqueue } from '../src/io.mjs';

const exec = promisify(execFile);
test('real tmux clients isolate sessions, follow panes, mirror shared sessions, and survive detach/reattach', { timeout: 20_000 }, () => fixture(async ({ dir, home, service }) => {
  const socket = path.join(dir, 'tmux.sock');
  const tmux = args => exec('/usr/bin/tmux', ['-S', socket, ...args], { env: { ...process.env, TMUX: '' } });
  const children = [];
  service.setTmuxObserver(new TmuxObserver(service.router));
  try {
    const first = (await tmux(['-f', '/dev/null', 'new-session', '-d', '-s', 'left', '-P', '-F', '#{pane_id}'])).stdout.trim();
    const second = (await tmux(['split-window', '-d', '-t', first, '-P', '-F', '#{pane_id}'])).stdout.trim();
    const third = (await tmux(['new-session', '-d', '-s', 'right', '-P', '-F', '#{pane_id}'])).stdout.trim();
    const serverPid = (await tmux(['display-message', '-p', '#{pid}'])).stdout.trim();
    const attach = async (target, session) => {
      const child = spawn(process.execPath, [path.join(project, 'bin/musume.mjs'), 'tmux', '--home', home, '--', '-S', socket, '-C', 'attach-session', '-t', session], { env: { ...process.env, TMUX: '', TMUX_PANE: '', TERMINAL_MUSUME_TARGET: target }, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdout.resume(); child.stderr.resume(); children.push(child);
      await eventually(async () => (await callController(home, 'status')).tmux.some(row => row.target === target));
      return child;
    };
    for (const id of ['A', 'B', 'C']) {
      await callController(home, 'createTarget', { id, name: id, commandline: 'cmd.exe' });
      await callController(home, 'claimTarget', { id, pid: process.pid });
    }
    await attach('A', 'left'); await attach('B', 'right'); await attach('C', 'left');
    for (const [run, provider, pane, name, text] of [['r1', 'claude', first, 'UserPromptSubmit', ''], ['r2', 'codex', second, 'Stop', '全部測試通過。'], ['r3', 'claude', third, 'PermissionRequest', '']]) {
      const location = { kind: 'tmux', server: socket, serverPid, pane };
      await callController(home, 'beginRun', { run, provider, location, pid: process.pid });
      const event = normalizeHook(provider, { hook_event_name: name, session_id: `llm-${run}`, last_assistant_message: text }, { env: { TERMINAL_MUSUME_RUN: run, TMUX: `${socket},${serverPid},0`, TMUX_PANE: pane, WT_SESSION: 'stale-inherited-tab' } });
      await enqueue(home, event);
    }
    await eventually(async () => {
      const { targets } = await callController(home, 'status');
      return targets.find(t => t.target === 'A').state === 'thinking' && targets.find(t => t.target === 'B').state === 'waiting';
    });
    await tmux(['select-pane', '-t', second]);
    await eventually(async () => {
      const { targets } = await callController(home, 'status');
      return targets.find(t => t.target === 'A').provider === 'codex' && targets.find(t => t.target === 'C').provider === 'codex' && targets.find(t => t.target === 'B').state === 'waiting';
    });
    const binding = (await callController(home, 'status')).tmux.find(row => row.target === 'A');
    const client = (await tmuxClients(socket)).find(row => row.pid === binding.clientPid);
    await tmux(['detach-client', '-t', client.name]);
    await eventually(async () => !(await callController(home, 'status')).tmux.some(row => row.target === 'A'));
    assert.equal((await callController(home, 'status')).targets.find(t => t.target === 'A').state, 'idle');
    // A new display attaches to the existing pane/run. The LLM never restarted.
    await callController(home, 'closeTarget', { id: 'A' });
    await callController(home, 'createTarget', { id: 'D', name: 'D', commandline: 'cmd.exe' });
    await callController(home, 'claimTarget', { id: 'D', pid: process.pid });
    await attach('D', 'left');
    await eventually(async () => (await callController(home, 'status')).targets.find(t => t.target === 'D').provider === 'codex');
    assert.equal((await callController(home, 'status')).targets.find(t => t.target === 'B').provider, 'claude');
  } finally {
    await tmux(['kill-server']).catch(() => {});
    for (const child of children) { child.stdin.destroy(); child.kill('SIGTERM'); }
  }
}));
