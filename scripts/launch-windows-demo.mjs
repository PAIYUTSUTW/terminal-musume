import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jsonc from 'jsonc-parser';
import { atomicWrite } from '../src/io.mjs';
import { parseSettings, toWindowsAssetPath } from '../src/windows-terminal.mjs';
import { runtimeHome } from '../src/runtime-home.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const home = runtimeHome({ scope: 'live-demo' });
try {
  const status = JSON.parse(await readFile(path.join(home, 'status.json'), 'utf8'));
  process.kill(status.pid, 0);
  process.stdout.write(`Live demo is already running (PID ${status.pid}). Use its Space / N / Q controls.\n`);
  process.exit(0);
} catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
const powershell = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const ps = async command => (await exec('/init', [powershell, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { timeout: 20_000 })).stdout.trim();
const windowsLocal = await ps('[Environment]::GetFolderPath("LocalApplicationData")');
const local = `/mnt/${windowsLocal[0].toLowerCase()}${windowsLocal.slice(2).replaceAll('\\', '/')}`;
const settingsPath = path.join(local, 'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
const packRoot = path.join(local, 'TerminalMusumeDemo/assets');
await mkdir(home, { recursive: true, mode: 0o700 });
await cp(path.join(root, 'assets/demo'), packRoot, { recursive: true });
let previous;
try { previous = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const profile = previous?.profile ?? `{${randomUUID()}}`;
const title = 'Terminal Musume - LIVE DEMO';
const distro = process.env.WSL_DISTRO_NAME;
if (!distro) throw new Error('Run this launcher inside your WSL distribution.');
// All quoted arguments are paths or locally discovered distribution names.
const winQuote = value => /[\s"]/u.test(value) ? `"${String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"` : String(value);
const commandline = ['wsl.exe', '-d', distro, '--cd', root, '--', process.execPath, path.join(root, 'scripts/live-demo.mjs')].map(winQuote).join(' ');
const raw = await readFile(settingsPath, 'utf8');
const data = parseSettings(raw);
if (data.useBackgroundImageForWindow === true) throw new Error('The live demo requires profile backgrounds; no settings were changed.');
if (!data.profiles.list.some(item => item.guid === profile)) {
  await writeFile(path.join(home, `settings-before-demo-${Date.now()}.json`), raw, { flag: 'wx', mode: 0o600 });
  const entry = { guid: profile, name: 'Terminal Musume Demo', commandline, hidden: false, closeOnExit: 'always', tabTitle: title, suppressApplicationTitle: true, font: { face: 'Cascadia Mono', size: 12 }, padding: '22', background: '#10131D', foreground: '#DCE4F0', useAcrylic: false, opacity: 100, backgroundImage: toWindowsAssetPath(path.join(packRoot, 'claude/idle.gif')), backgroundImageOpacity: 0.52, backgroundImageStretchMode: 'none', backgroundImageAlignment: 'bottomRight' };
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = raw.replace(/^\uFEFF/, '');
  const text = jsonc.applyEdits(source, jsonc.modify(source, ['profiles', 'list', -1], entry, { formattingOptions: { insertSpaces: true, tabSize: 4, eol: raw.includes('\r\n') ? '\r\n' : '\n' } }));
  if (await readFile(settingsPath, 'utf8') !== raw) throw new Error('Settings changed during preparation. Retry the launcher.');
  await atomicWrite(settingsPath, bom + text);
} else {
  const index = data.profiles.list.findIndex(item => item.guid === profile);
  let text = jsonc.applyEdits(raw, jsonc.modify(raw, ['profiles', 'list', index, 'commandline'], commandline, { formattingOptions: { insertSpaces: true, tabSize: 4 } }));
  text = jsonc.applyEdits(text, jsonc.modify(text, ['profiles', 'list', index, 'closeOnExit'], 'always', { formattingOptions: { insertSpaces: true, tabSize: 4 } }));
  if (text !== raw) await atomicWrite(settingsPath, text);
}
await atomicWrite(path.join(home, 'config.json'), JSON.stringify({ settingsPath, packRoot, profile, title, windowsLocal, distro }, null, 2));
const escapedTitle = title.replaceAll("'", "''");
const output = await ps(`Start-Process -FilePath wt.exe -ArgumentList '--window new --size 108,32 --pos 80,80 new-tab --profile ${profile} --title "${escapedTitle}" --suppressApplicationTitle'; Start-Sleep -Milliseconds 2000; Get-Process WindowsTerminal | Select-Object Id,SessionId,MainWindowHandle,MainWindowTitle | ConvertTo-Json -Compress`);
process.stdout.write(JSON.stringify({ profile, title, packRoot, output }) + '\n');
