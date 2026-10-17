import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, eventually, project } from './helpers.mjs';
import { callController } from '../src/rpc.mjs';
import { TmuxObserver } from '../src/tmux.mjs';
import { parseSettings } from '../src/windows-terminal.mjs';

const exec = promisify(execFile);
test('real tmux pane agent + real hook subprocess + direct agent update only their own Windows profiles', { timeout: 20_000 }, () => fixture(async ({ dir, home, settingsPath, service, original }) => {
  const socket = path.join(dir, 'tmux.sock');
  const tmux = args => exec('/usr/bin/tmux', ['-S', socket, ...args], { env: { ...process.env, TMUX: '' } });
  const children = [];
  const fake = path.join(dir, 'fixture-agent.mjs');
  await writeFile(fake, `#!${process.execPath}\nimport{readFile}from'node:fs/promises';import{spawn}from'node:child_process';let a=process.argv.slice(2);let cfg=JSON.parse(await readFile(a[a.indexOf('--settings')+1],'utf8'));let name=a.includes('--waiting')?'PermissionRequest':'Stop';let p=spawn(cfg.hooks[name][0].hooks[0].command,{shell:true,stdio:['pipe','ignore','inherit']});p.stdin.end(JSON.stringify({hook_event_name:name,session_id:'same-session-id',last_assistant_message:'全部測試通過，沒有錯誤。'}));await new Promise(r=>p.on('exit',r));setInterval(()=>{},1000);\n`, { mode: 0o700 });
  service.setTmuxObserver(new TmuxObserver(service.router));
  try {
    for (const id of ['A', 'B']) {
      await callController(home, 'createTarget', { id, name: id, commandline: 'cmd.exe' });
      await callController(home, 'claimTarget', { id, pid: process.pid });
    }
    const pane = (await tmux(['-f', '/dev/null', 'new-session', '-d', '-s', 'work', '-P', '-F', '#{pane_id}', process.execPath, path.join(project, 'bin/musume.mjs'), 'run', '--home', home, '--provider', 'claude', '--exe', fake])).stdout.trim();
    const attach = spawn(process.execPath, [path.join(project, 'bin/musume.mjs'), 'tmux', '--home', home, '--', '-S', socket, '-C', 'attach-session', '-t', 'work'], { env: { ...process.env, TMUX: '', TMUX_PANE: '', TERMINAL_MUSUME_TARGET: 'A' }, stdio: ['pipe', 'pipe', 'pipe'] });
    attach.stdout.resume(); attach.stderr.resume(); children.push(attach);
    const direct = spawn(process.execPath, [path.join(project, 'bin/musume.mjs'), 'run', '--home', home, '--provider', 'claude', '--exe', fake, '--', '--waiting'], { env: { ...process.env, TMUX: '', TMUX_PANE: '', TERMINAL_MUSUME_TERMINAL: 'B' }, stdio: ['ignore', 'pipe', 'pipe'] });
    direct.stdout.resume(); direct.stderr.resume(); children.push(direct);
    await eventually(async () => {
      const status = await callController(home, 'status');
      return status.targets.find(t => t.target === 'A').state === 'happy' && status.targets.find(t => t.target === 'B').state === 'waiting';
    });
    const status = await callController(home, 'status');
    const a = status.targets.find(t => t.target === 'A'), b = status.targets.find(t => t.target === 'B');
    assert.equal(a.view.pane, pane); assert.notEqual(a.run, b.run); assert.equal(a.session, b.session);
    const data = parseSettings(await readFile(settingsPath, 'utf8'));
    assert.equal(data.profiles.list.find(p => p.guid === a.profile).backgroundImage, 'C:\\musume\\claude\\happy.gif');
    assert.equal(data.profiles.list.find(p => p.guid === b.profile).backgroundImage, 'C:\\musume\\claude\\waiting.gif');
    assert.deepEqual(data.profiles.list[0], original.profiles.list[0]);
    assert.ok(!JSON.stringify(status).includes('全部測試通過')); assert.equal(status.lastError, null);
    // An event from an older direct process cannot affect the new foreground run.
    await callController(home, 'beginRun', { run: 'replacement', provider: 'codex', location: { kind: 'direct', terminal: 'B' }, pid: process.pid });
    await exec(process.execPath, [path.join(project, 'bin/emit-hook.mjs'), '--provider', 'claude', '--home', home, '--event', 'Stop', '--session', 'same-session-id', '--text', '仍有測試失敗。'], { env: { ...process.env, TMUX: '', TMUX_PANE: '', TERMINAL_MUSUME_RUN: b.run, TERMINAL_MUSUME_TERMINAL: 'B' } });
    await service.tick();
    const final = (await callController(home, 'status')).targets;
    assert.equal(final.find(t => t.target === 'B').provider, 'codex'); assert.equal(final.find(t => t.target === 'B').state, 'idle');
    assert.equal(final.find(t => t.target === 'A').state, 'happy');
  } finally {
    await tmux(['kill-server']).catch(() => {});
    for (const child of children) { child.stdin?.destroy(); child.kill('SIGTERM'); }
  }
}));
