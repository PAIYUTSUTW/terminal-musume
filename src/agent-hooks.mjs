import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './io.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
export const windowsQuote = value => /[\s"]/u.test(value) ? `"${String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"` : String(value);
const events = {
  codex: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd'],
  claude: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd'],
};
export function hookConfig(provider, home) {
  if (!events[provider]) throw new Error('Choose claude or codex.');
  const command = [process.execPath, path.join(root, 'bin/emit-hook.mjs'), '--provider', provider, '--home', path.resolve(home)].map(shellQuote).join(' ');
  return { hooks: Object.fromEntries(events[provider].map(event => [event, [{ hooks: [{ type: 'command', command, timeout: 2 }] }]])) };
}
const toml = value => {
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, val]) => `${JSON.stringify(key)}=${toml(val)}`).join(',')}}`;
  return JSON.stringify(value);
};
export async function agentInvocation(provider, args, { home, run }) {
  const config = hookConfig(provider, home);
  if (provider === 'claude') {
    const file = path.join(home, 'runs', `${run}-hooks.json`);
    await atomicWrite(file, JSON.stringify(config));
    return ['--settings', file, ...args];
  }
  // Keep hooks scoped to this invocation. Codex's native trust review still
  // applies; never add --dangerously-bypass-hook-trust here.
  return [...Object.entries(config.hooks).flatMap(([event, handlers]) => ['-c', `hooks.${event}=${toml(handlers)}`]), ...args];
}
