import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { callController } from './rpc.mjs';

const exec = promisify(execFile);
const FORMAT = '#{client_pid}\t#{client_name}\t#{session_id}\t#{window_id}\t#{pane_id}\t#{pid}';
export function tmuxSocket(args, env = process.env, cwd = process.cwd()) {
  let name = 'default', explicit;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-') || arg === '--') break;
    if (arg === '-S' || arg === '-L') { const value = args[++i]; if (!value) throw new Error(`${arg} needs a value.`); if (arg === '-S') explicit = value; else name = value; }
    else if (arg.startsWith('-S') && arg.length > 2) explicit = arg.slice(2);
    else if (arg.startsWith('-L') && arg.length > 2) name = arg.slice(2);
    else if (['-f', '-T', '-c'].includes(arg)) i++;
  }
  if (explicit) return path.resolve(cwd, explicit);
  return path.join(env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid()}`, name);
}
export async function tmuxClients(server, executable = '/usr/bin/tmux') {
  const { stdout } = await exec(executable, ['-S', server, 'list-clients', '-F', FORMAT], { timeout: 1200, maxBuffer: 256 * 1024, env: { ...process.env, TMUX: '' } });
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [pid, name, session, window, pane, serverPid] = line.split('\t');
    if (!/^\d+$/.test(pid) || !/^%\d+$/.test(pane ?? '') || !/^\d+$/.test(serverPid ?? '')) throw new Error('Invalid tmux client metadata.');
    return { pid: Number(pid), name, session, window, pane, serverPid };
  });
}
export class TmuxObserver {
  bindings = new Map();
  constructor(router, { executable = '/usr/bin/tmux' } = {}) { this.router = router; this.executable = executable; }
  async validate({ server, serverPid, clientPid }) {
    if (typeof server !== 'string' || !server.startsWith('/') || !/^[1-9]\d*$/.test(String(serverPid)) || !Number.isInteger(clientPid)) throw new Error('Invalid tmux binding.');
    const clients = await tmuxClients(server, this.executable);
    if (!clients.some(client => client.pid === clientPid && client.serverPid === String(serverPid))) throw new Error('tmux client no longer exists.');
  }
  async refresh() {
    const sockets = [...new Set([...this.bindings.values()].map(binding => binding.server))];
    const snapshots = new Map(await Promise.all(sockets.map(async server => {
      try { return [server, await tmuxClients(server, this.executable)]; } catch { return [server, null]; }
    })));
    for (const [target, binding] of this.bindings) {
      if (!this.router.targets.has(target)) { this.bindings.delete(target); continue; }
      const clients = snapshots.get(binding.server);
      // A temporary query failure must not route to a different pane/client.
      if (clients === null) { this.router.setView(target, null); continue; }
      const client = clients.find(row => row.pid === binding.clientPid && row.serverPid === String(binding.serverPid));
      if (!client) { this.bindings.delete(target); this.router.directView(target); continue; }
      this.router.setView(target, { kind: 'tmux', server: binding.server, serverPid: client.serverPid, pane: client.pane });
    }
  }
}

export async function runTmux({ home, args = [], env = process.env, executable = '/usr/bin/tmux', stdio = 'inherit' }) {
  const target = env.TERMINAL_MUSUME_TARGET;
  const track = Boolean(target && !env.TMUX && !env.TMUX_PANE);
  const server = track ? tmuxSocket(args, env) : undefined;
  const child = spawn(executable, args, { env, stdio });
  let finished = false, bound = false;
  const exited = new Promise((resolve, reject) => {
    child.once('error', error => { finished = true; reject(error); });
    child.once('exit', (code, signal) => { finished = true; resolve({ code: code ?? (signal === 'SIGINT' ? 130 : 1), signal }); });
  });
  exited.catch(() => {});
  const handleINT = () => {}, handleTERM = () => child.kill('SIGTERM');
  process.on('SIGINT', handleINT); process.on('SIGTERM', handleTERM);
  try {
    // Only a real attached client gets a display binding. Commands such as
    // split-window, -V or new-session -d pass through with their original exit.
    while (track && !finished && !bound) {
      try {
        const client = (await tmuxClients(server, executable)).find(row => row.pid === child.pid);
        if (client) {
          await callController(home, 'bindTmux', { target, server, serverPid: client.serverPid, clientPid: child.pid }); bound = true;
        }
      } catch (error) {
        if (error.message.includes('adapter is not enabled') || error.message.includes('Invalid tmux client binding')) throw error;
      }
      if (!finished && !bound) await delay(80);
    }
    return await exited;
  } catch (error) { child.kill('SIGTERM'); await exited.catch(() => {}); throw error; }
  finally {
    process.off('SIGINT', handleINT); process.off('SIGTERM', handleTERM);
    if (bound) await callController(home, 'unbindTmux', { target, clientPid: child.pid }).catch(() => {});
  }
}
