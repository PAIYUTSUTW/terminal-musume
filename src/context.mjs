import { randomUUID } from 'node:crypto';

const id = (value, label) => {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\x00-\x1f]/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
};

export function validateLocation(location) {
  if (location?.kind === 'direct') return { kind: 'direct', terminal: id(location.terminal, 'terminal ID') };
  if (location?.kind === 'tmux') {
    const server = id(location.server, 'tmux socket');
    const serverPid = id(String(location.serverPid ?? ''), 'tmux server PID');
    if (!server.startsWith('/') || !/^[1-9]\d*$/.test(serverPid) || !/^%\d+$/.test(location.pane ?? '')) throw new Error('Invalid tmux location.');
    return { kind: 'tmux', server, serverPid, pane: location.pane };
  }
  throw new Error('A direct or tmux location is required.');
}

export function locationFromEnv(env = process.env) {
  // Inside tmux, never route using inherited WT_SESSION or the outer wrapper's
  // terminal token. Processes may outlive, or be displayed by several clients.
  if (env.TMUX || env.TMUX_PANE) {
    const match = /^(.*),([1-9]\d*),\d+$/.exec(env.TMUX ?? '');
    if (!match) throw new Error('Invalid TMUX environment.');
    return validateLocation({ kind: 'tmux', server: match[1], serverPid: match[2], pane: env.TMUX_PANE });
  }
  return validateLocation({ kind: 'direct', terminal: env.TERMINAL_MUSUME_TERMINAL ?? env.WT_SESSION });
}

export const locationKey = value => {
  const location = validateLocation(value);
  return JSON.stringify(location.kind === 'direct' ? ['direct', location.terminal] : ['tmux', location.server, location.serverPid, location.pane]);
};

export function hookIdentity(payload, env = process.env) {
  const run = env.TERMINAL_MUSUME_RUN;
  if (!run) return undefined; // Keep the standalone v1 preview compatible.
  return { run: id(run, 'run ID'), location: locationFromEnv(env) };
}

export function createRun(provider, location, { run = randomUUID(), at = Date.now(), pid = process.pid } = {}) {
  if (!['claude', 'codex'].includes(provider)) throw new Error('Invalid agent provider.');
  return { run: id(run, 'run ID'), provider, location: validateLocation(location), at, pid };
}
