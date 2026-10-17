#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { MultiTerminal } from '../src/multi-terminal.mjs';
import { startController } from '../src/controller.mjs';
import { loadPack } from '../src/pack.mjs';
import { callController } from '../src/rpc.mjs';
import { runAgent } from '../src/agent-runner.mjs';
import { hookConfig, shellQuote } from '../src/agent-hooks.mjs';
import { readJSON } from '../src/io.mjs';
import { TmuxObserver } from '../src/tmux.mjs';
import { runtimeHome } from '../src/runtime-home.mjs';
import { windowsDefaults, writeWrappers, targetCommand, launchTab, ensureController } from '../src/windows-launch.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  home: { type: 'string', default: runtimeHome() },
  settings: { type: 'string' }, 'base-profile': { type: 'string' }, pack: { type: 'string' }, 'windows-pack-root': { type: 'string' },
  port: { type: 'string', default: '0' }, opacity: { type: 'string', default: '.38' },
  provider: { type: 'string' }, mode: { type: 'string' }, exe: { type: 'string' }, window: { type: 'string', default: 'terminal-musume' }, title: { type: 'string' }, cwd: { type: 'string' },
} });
const [command = 'help', ...args] = positionals;
const home = path.resolve(values.home);
try {
  if (command === 'service') {
    const defaults = values.settings && values.pack ? {} : await windowsDefaults();
    const settingsPath = values.settings ?? defaults.settingsPath, packRoot = values.pack ?? defaults.pack;
    const opacity = Number(values.opacity), port = Number(values.port);
    if (!(opacity >= 0 && opacity <= 1) || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid opacity or port.');
    await writeWrappers(home);
    const writer = await new MultiTerminal({ settingsPath, home, baseProfile: values['base-profile'] }).open();
    let service;
    try { service = await startController({ home, writer, pack: await loadPack(packRoot), windowsPackRoot: values['windows-pack-root'], port, opacity }); }
    catch (error) { await writer.close(); throw error; }
    service.setTmuxObserver(new TmuxObserver(service.router));
    console.log(`Terminal Musume controller: ${service.url}`);
    const close = () => service.close().catch(error => { console.error(error.message); process.exitCode = 1; });
    process.once('SIGINT', close); process.once('SIGTERM', close);
  } else if (command === 'open') {
    const mode = values.mode ?? (values.provider ? 'agent' : 'shell');
    if (!['shell', 'agent', 'tmux', 'demo'].includes(mode)) throw new Error('Choose shell, agent, tmux, or demo mode.');
    if (mode === 'agent' && !['claude', 'codex'].includes(values.provider)) throw new Error('Choose --provider claude or codex.');
    const options = { settings: values.settings, 'base-profile': values['base-profile'], pack: values.pack, 'windows-pack-root': values['windows-pack-root'], opacity: values.opacity };
    await ensureController(home, options);
    const id = randomUUID(), cwd = path.resolve(values.cwd ?? process.cwd());
    const name = values.title ?? `Musume ${values.provider ?? mode} ${id.slice(0, 6)}`;
    const target = await callController(home, 'createTarget', { id, name, provider: values.provider ?? 'claude', commandline: targetCommand(home, id, cwd), launch: { mode, provider: values.provider, args, cwd } });
    try { await launchTab(target.profile, { window: values.window, title: name }); }
    catch (error) { await callController(home, 'closeTarget', { id }).catch(() => {}); throw error; }
    console.log(JSON.stringify(target));
  } else if (command === 'run') {
    const executables = await readJSON(path.join(home, 'executables.json'), {});
    const result = await runAgent({ provider: values.provider, args, home, executable: values.exe ?? executables[values.provider] ?? values.provider });
    process.exitCode = result.code;
  } else if (command === 'tmux') {
    const { runTmux } = await import('../src/tmux.mjs');
    process.exitCode = (await runTmux({ home, args, executable: values.exe ?? '/usr/bin/tmux' })).code;
  } else if (command === 'status') console.log(JSON.stringify(await callController(home, 'status'), null, 2));
  else if (command === 'env') console.log(`export TERMINAL_MUSUME_HOME=${shellQuote(home)}\nexport PATH=${shellQuote(path.join(home, 'bin'))}:"$PATH"`);
  else if (command === 'stop') console.log(JSON.stringify(await callController(home, 'stop')));
  else if (command === 'hooks') console.log(JSON.stringify(hookConfig(values.provider, home), null, 2));
  else console.log(`Terminal Musume\n\n  musume open                         Open an isolated shell tab\n  musume open --provider claude        Open Claude with reply hooks\n  musume open --provider codex         Open Codex with reply hooks\n  musume open --mode tmux -- new-session -A -s work\n  musume run --provider codex -- <CLI arguments>\n  musume tmux -- attach-session -t work\n  musume status\n  musume stop\n\nUse --home for a different controller runtime. Generated shell wrappers keep the\nnormal claude/codex/tmux commands inside managed tabs. Codex hooks use its native\ntrust review. Existing tmux panes may need the explicit musume run command.`);
} catch (error) { console.error(`Terminal Musume: ${error.message}`); process.exitCode = 1; }
