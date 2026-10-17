import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fixture, eventually, project } from './helpers.mjs';
import { callController } from '../src/rpc.mjs';
import { agentInvocation, hookConfig } from '../src/agent-hooks.mjs';

test('provider hook arguments preserve user argv and do not bypass native trust or write global settings', () => fixture(async ({ home }) => {
  const args = ['--model', 'a model', 'quotes " and ; $(literal)'];
  const claude = await agentInvocation('claude', args, { home, run: 'c' });
  assert.deepEqual(claude.slice(2), args);
  assert.deepEqual(JSON.parse(await readFile(claude[1], 'utf8')), hookConfig('claude', home));
  const codex = await agentInvocation('codex', args, { home, run: 'd' });
  assert.deepEqual(codex.slice(-args.length), args); assert.ok(codex.includes('-c'));
  assert.ok(codex.some(arg => arg.startsWith('hooks.Stop=')));
  assert.ok(!codex.join(' ').includes('dangerously-bypass'));
}));
test('real agent wrapper inherits run/terminal identity, handles real hooks and unregisters on exit', () => fixture(async ({ home, dir, service }) => {
  await callController(home, 'createTarget', { id: 'A', name: 'A', commandline: 'cmd.exe' });
  await callController(home, 'claimTarget', { id: 'A', pid: process.pid });
  const received = path.join(dir, 'argv.json'), cli = path.join(dir, 'fake-claude.mjs');
  await writeFile(cli, `#!${process.execPath}\nimport{writeFile,readFile}from'node:fs/promises';import{spawn}from'node:child_process';await writeFile(${JSON.stringify(received)},JSON.stringify(process.argv.slice(2)));let args=process.argv.slice(2);let cfg=JSON.parse(await readFile(args[args.indexOf('--settings')+1],'utf8'));let cmd=cfg.hooks.Stop[0].hooks[0].command;let child=spawn(cmd,{shell:true,stdio:['pipe','ignore','inherit']});child.stdin.end(JSON.stringify({hook_event_name:'Stop',session_id:'real-payload-session',last_assistant_message:'全部測試通過！'}));await new Promise(r=>child.on('exit',r));setTimeout(()=>process.exit(0),1500);\n`, { mode: 0o700 });
  const child = spawn(process.execPath, [path.join(project, 'bin/musume.mjs'), 'run', '--home', home, '--provider', 'claude', '--exe', cli, '--', '--model', 'literal space'], { env: { ...process.env, TERMINAL_MUSUME_TERMINAL: 'A', TMUX: '', TMUX_PANE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    await eventually(async () => (await callController(home, 'status')).targets[0].state === 'happy');
    const state = (await callController(home, 'status')).targets[0];
    assert.equal(state.session, 'real-payload-session'); assert.ok(!JSON.stringify(service.snapshot()).includes('全部測試通過'));
    assert.deepEqual(JSON.parse(await readFile(received, 'utf8')).slice(2), ['--model', 'literal space']);
    assert.equal(await exited, 0, stderr);
    await eventually(async () => (await callController(home, 'status')).targets[0].state === 'idle');
  } finally { child.kill('SIGTERM'); }
}));
