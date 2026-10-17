#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { atomicWrite } from '../src/io.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { callController } from '../src/rpc.mjs';

const { values } = parseArgs({ options: { home: { type: 'string' }, target: { type: 'string' } } });
const home = path.resolve(values.home);
let claimed = false;
try {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(values.target ?? '')) throw new Error('Invalid target ID.');
  const target = JSON.parse(await readFile(path.join(home, 'targets', `${values.target}.json`), 'utf8'));
  await callController(home, 'claimTarget', { id: target.id, pid: process.pid, wtSession: process.env.WT_SESSION }); claimed = true;
  const env = { ...process.env, TERMINAL_MUSUME_HOME: home, TERMINAL_MUSUME_TARGET: target.id, TERMINAL_MUSUME_TERMINAL: target.id, PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env.PATH}` };
  delete env.TMUX; delete env.TMUX_PANE; delete env.TERMINAL_MUSUME_RUN;
  process.chdir(target.launch.cwd ?? process.cwd());
  if (target.launch.mode === 'agent') {
    // Run the wrapper itself: it already records the original executable and
    // creates the agent run with the correct inherited terminal environment.
    const child = spawn(path.join(home, 'bin', target.launch.provider), target.launch.args ?? [], { env, stdio: 'inherit' });
    process.on('SIGINT', () => {}); process.on('SIGTERM', () => child.kill('SIGTERM'));
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  } else if (target.launch.mode === 'tmux') {
    const { runTmux } = await import('../src/tmux.mjs');
    process.exitCode = (await runTmux({ home, args: target.launch.args?.length ? target.launch.args : ['new-session', '-A', '-s', 'musume'], env })).code;
  } else if (target.launch.mode === 'demo') {
    const { runDemoTarget } = await import('../scripts/demo-target-v2.mjs');
    await runDemoTarget({ home, target, env });
  } else {
    const child = spawn('/bin/bash', ['--rcfile', path.join(home, 'managed.bashrc'), '-i'], { env, stdio: 'inherit' });
    process.on('SIGINT', () => {}); process.on('SIGTERM', () => child.kill('SIGTERM'));
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  }
} catch (error) {
  console.error(`Terminal Musume: ${error.message}`); process.exitCode = 1;
  if (/^[a-zA-Z0-9_-]{1,100}$/.test(values.target ?? '')) await atomicWrite(path.join(home, 'errors', `${values.target}.txt`), `${error.stack}\n`).catch(() => {});
}
finally { if (claimed) await callController(home, 'closeTarget', { id: values.target }).catch(() => {}); }
