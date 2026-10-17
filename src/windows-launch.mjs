import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access, cp, mkdir, readFile, writeFile, chmod, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { shellQuote, windowsQuote } from './agent-hooks.mjs';
import { callController } from './rpc.mjs';
import { atomicWrite } from './io.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
export const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
export async function powershell(command) {
  const executable = process.platform === 'win32' ? 'powershell.exe' : '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; ${command}`];
  const result = await exec(process.platform === 'win32' ? executable : '/init', process.platform === 'win32' ? args : [executable, ...args], { timeout: 20_000, windowsHide: true });
  return result.stdout.trim();
}
export async function windowsDefaults() {
  if (process.platform === 'win32' || !process.env.WSL_DISTRO_NAME) throw new Error('The v2 launcher runs inside WSL. Open your WSL distribution first.');
  const windowsLocal = await powershell('[Environment]::GetFolderPath("LocalApplicationData")');
  const local = process.platform === 'win32' ? windowsLocal : `/mnt/${windowsLocal[0].toLowerCase()}${windowsLocal.slice(2).replaceAll('\\', '/')}`;
  const pack = path.join(local, 'TerminalMusume/assets-v2');
  await mkdir(path.dirname(pack), { recursive: true });
  await cp(path.join(root, 'assets/demo'), pack, { recursive: true });
  return { settingsPath: path.join(local, 'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json'), pack };
}
export function targetCommand(home, target, cwd) {
  const argv = [process.execPath, path.join(root, 'bin/target-runner.mjs'), '--home', home, '--target', target];
  return (process.platform === 'win32' ? argv : ['wsl.exe', '-d', process.env.WSL_DISTRO_NAME, '--cd', cwd, '--', ...argv]).map(windowsQuote).join(' ');
}
export async function launchTab(profile, { window = 'terminal-musume', title = 'Terminal Musume' } = {}) {
  await delay(350); // Let the existing Terminal process reload the new profile.
  const args = ['--window', window, 'new-tab', '--profile', profile, '--title', title, '--suppressApplicationTitle'].map(windowsQuote).join(' ');
  await powershell(`Start-Process -FilePath wt.exe -ArgumentList ${psQuote(args)}; Start-Sleep -Milliseconds 500`);
}
async function findExecutable(name, home) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (path.resolve(directory) === path.join(home, 'bin')) continue;
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      let header = '';
      try {
        const handle = await open(candidate, 'r');
        try { const buffer = Buffer.alloc(2048); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); header = buffer.subarray(0, bytesRead).toString(); }
        finally { await handle.close(); }
      } catch {}
      if (header.includes(shellQuote(path.join(root, 'bin/musume.mjs')))) continue;
      return candidate;
    } catch {}
  }
  return name;
}
export async function writeWrappers(home) {
  const directory = path.join(home, 'bin');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const nodeCLI = `${shellQuote(process.execPath)} ${shellQuote(path.join(root, 'bin/musume.mjs'))}`;
  const writeWrapper = (name, contents) => atomicWrite(path.join(directory, name), contents, { mode: 0o700 });
  const executables = {};
  for (const provider of ['claude', 'codex']) {
    const executable = await findExecutable(provider, home);
    executables[provider] = executable;
    await writeWrapper(provider, `#!/bin/sh\nexec ${nodeCLI} run --home ${shellQuote(home)} --provider ${provider} --exe ${shellQuote(executable)} -- "$@"\n`);
  }
  const tmux = await findExecutable('tmux', home);
  executables.tmux = tmux;
  await writeWrapper('tmux', `#!/bin/sh\nexec ${nodeCLI} tmux --home ${shellQuote(home)} --exe ${shellQuote(tmux)} -- "$@"\n`);
  await writeWrapper('musume', `#!/bin/sh\nexec ${nodeCLI} --home ${shellQuote(home)} "$@"\n`);
  for (const file of ['claude', 'codex', 'tmux', 'musume']) await chmod(path.join(directory, file), 0o700);
  await writeFile(path.join(home, 'managed.bashrc'), `if [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi\nexport PATH=${shellQuote(directory)}:"$PATH"\n`, { mode: 0o600 });
  await writeFile(path.join(home, 'executables.json'), JSON.stringify(executables), { mode: 0o600 });
  // WSL's non-interactive launch may not load nvm. Fixtures and user-installed
  // scripts with '#!/usr/bin/env node' still need the running Node executable.
  await writeWrapper('node', `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$@"\n`);
}
export async function ensureController(home, options = {}) {
  try { await callController(home, 'status', {}, { timeout: 700 }); return; } catch {}
  await mkdir(home, { recursive: true, mode: 0o700 });
  const args = [path.join(root, 'bin/musume.mjs'), 'service', '--home', home];
  for (const [key, value] of Object.entries(options)) if (value !== undefined) args.push(`--${key}`, String(value));
  const log = await open(path.join(home, 'controller.log'), 'a', 0o600);
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', log.fd, log.fd], env: process.env });
  let failure;
  child.once('error', error => { failure = error; }); child.unref(); await log.close();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (failure) throw failure;
    try { await callController(home, 'status', {}, { timeout: 300 }); return; } catch {}
    await delay(100);
  }
  throw new Error(`Controller did not start. See ${path.join(home, 'controller.log')}.`);
}
