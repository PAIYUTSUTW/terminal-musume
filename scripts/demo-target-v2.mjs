import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { atomicWrite } from '../src/io.mjs';
import { runAgent } from '../src/agent-runner.mjs';
import { runTmux } from '../src/tmux.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
export async function runDemoTarget({ home, target, env }) {
  const args = target.launch.args ?? [];
  const fixture = path.join(root, 'scripts/demo-hook-agent.mjs');
  const prefix = target.id.slice(0, 8);
  if (!args.includes('--tmux')) {
    return runAgent({ provider: target.launch.provider ?? 'claude', args: ['--fixture-id', `${prefix}-direct`, '--fixture-provider', target.launch.provider ?? 'claude', '--fixture-state', 'thinking'], home, executable: fixture, env });
  }
  const socket = path.join(home, 'demo', `${prefix}.sock`);
  await mkdir(path.dirname(socket), { recursive: true, mode: 0o700 });
  const tmux = command => exec('/usr/bin/tmux', ['-S', socket, ...command], { env });
  const actor = (provider, suffix, state) => [process.execPath, path.join(root, 'bin/musume.mjs'), 'run', '--home', home, '--provider', provider, '--exe', fixture, '--', '--fixture-id', `${prefix}-${suffix}`, '--fixture-provider', provider, '--fixture-state', state];
  const left = (await tmux(['-f', '/dev/null', 'new-session', '-d', '-s', 'musume-demo', '-P', '-F', '#{pane_id}', ...actor('claude', 'left', 'thinking')])).stdout.trim();
  const right = (await tmux(['split-window', '-h', '-d', '-t', left, '-P', '-F', '#{pane_id}', ...actor('codex', 'right', 'happy')])).stdout.trim();
  await tmux(['set-option', 'status-style', 'bg=default,fg=colour244']);
  // Public demo captures should not expose tmux's default hostname field.
  await tmux(['set-option', 'status-right', 'Terminal Musume demo']);
  await tmux(['select-pane', '-t', left]);
  await atomicWrite(path.join(home, 'demo', `${prefix}.tmux.json`), JSON.stringify({ socket, left, right, target: target.id, prefix }));
  // Detaching leaves the fixture server alive so the verifier can reattach it
  // from another display. The verification owner cleans up this private socket.
  return runTmux({ home, args: ['-S', socket, 'attach-session', '-t', 'musume-demo'], env });
}
