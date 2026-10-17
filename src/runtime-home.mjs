import os from 'node:os';
import path from 'node:path';

// Runtime tokens, reply queues, settings backups, and tmux sockets must not
// follow a checkout into a synchronized folder or a public source archive.
export function runtimeHome({ scope = 'v2', env = process.env, platform = process.platform, userHome = os.homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (env.TERMINAL_MUSUME_HOME) return paths.resolve(env.TERMINAL_MUSUME_HOME);
  const stateRoot = platform === 'win32'
    ? paths.join(env.LOCALAPPDATA || paths.join(userHome, 'AppData', 'Local'), 'TerminalMusume', 'state')
    : paths.join(env.XDG_STATE_HOME && paths.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : paths.join(userHome, '.local', 'state'), 'terminal-musume');
  return scope ? paths.join(stateRoot, scope) : stateRoot;
}
