import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callController } from '../src/rpc.mjs';
import { atomicWrite } from '../src/io.mjs';
import { powershell, psQuote, ensureController } from '../src/windows-launch.mjs';
import { parseSettings, toWindowsAssetPath } from '../src/windows-terminal.mjs';
import { tmuxClients } from '../src/tmux.mjs';
import { runtimeHome } from '../src/runtime-home.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const home = runtimeHome(), artifacts = path.join(root, 'artifacts');
const exec = promisify(execFile), windowName = 'terminal-musume-v2';
const keep = process.argv.includes('--keep');
await mkdir(artifacts, { recursive: true });
async function until(fn, timeout = 10_000) {
  const deadline = Date.now() + timeout; let error;
  while (Date.now() < deadline) { try { const result = await fn(); if (result) return result; } catch (value) { error = value; } await delay(100); }
  throw error ?? new Error('Real-device verification timed out.');
}
const status = () => callController(home, 'status');
async function openDemo(tmux = false) {
  const args = [path.join(root, 'bin/musume.mjs'), 'open', '--home', home, '--mode', 'demo', '--provider', 'claude', '--window', windowName, '--title', tmux ? 'Musume v2 B - tmux' : 'Musume v2 A - Direct'];
  if (tmux) args.push('--', '--tmux');
  const result = JSON.parse((await exec(process.execPath, args, { timeout: 15_000 })).stdout);
  await until(async () => (await status()).targets.find(t => t.target === result.id)?.session);
  return result;
}
await ensureController(home);
const config = JSON.parse(await readFile(path.join(home, 'controller.json'), 'utf8'));
let existing = await status(), a, b;
for (const target of existing.targets) {
  const manifest = JSON.parse(await readFile(path.join(home, 'targets', `${target.target}.json`), 'utf8'));
  if (manifest.launch.mode !== 'demo') throw new Error('Close managed working tabs before running the demo verifier. No existing tabs were changed.');
  if (manifest.launch.mode === 'demo') {
    if (manifest.launch.args.includes('--tmux')) b = { id: target.target, profile: target.profile };
    else a = { id: target.target, profile: target.profile };
  }
}
const baseline = parseSettings(await readFile(config.settingsPath, 'utf8'));
const ownedProfiles = new Set([a?.profile, b?.profile].filter(Boolean));
baseline.profiles.list = baseline.profiles.list.filter(profile => !ownedProfiles.has(profile.guid));
a ??= await openDemo(false); b ??= await openDemo(true);
const fixtureA = `${a.id.slice(0, 8)}-direct`;
const tmux = await until(async () => JSON.parse(await readFile(path.join(home, 'demo', `${b.id.slice(0, 8)}.tmux.json`), 'utf8')));
const fixtureLeft = `${tmux.prefix}-left`, fixtureRight = `${tmux.prefix}-right`;
const tmuxCommand = args => exec('/usr/bin/tmux', ['-S', tmux.socket, ...args]);
const frames = [], evidence = [];
let captureDirectory;
async function setFixture(id, state) {
  await atomicWrite(path.join(home, 'demo', `${id}.command.json`), JSON.stringify({ state }));
  await until(async () => JSON.parse(await readFile(path.join(home, 'demo', `${id}.status.json`), 'utf8')).state === state);
}
async function focus(index) {
  await powershell(`Start-Process -FilePath wt.exe -ArgumentList ${psQuote(`--window ${windowName} focus-tab --target ${index}`)}; Start-Sleep -Milliseconds 400`);
}
async function capture(prefix, animated = true) {
  const script = toWindowsAssetPath(path.join(root, 'scripts/capture-windows-demo.ps1'));
  const invoke = async extra => JSON.parse((await exec('/init', ['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-TitlePattern', '*Musume v2*', '-Prefix', prefix, ...extra], { timeout: 20_000 })).stdout);
  const still = await invoke([]);
  captureDirectory = `/mnt/${still.OutputDirectory[0].toLowerCase()}${still.OutputDirectory.slice(2).replaceAll('\\', '/')}`;
  await copyFile(path.join(captureDirectory, `${prefix}-00000.png`), path.join(artifacts, `${prefix}.png`));
  if (!animated) return { ...still, screenshot: `${prefix}.png` };
  const sequence = await invoke(['-Frames', '12', '-Fps', '4', '-Format', 'jpg']);
  const files = (await readdir(captureDirectory)).filter(file => file.startsWith(`${prefix}-`) && file.endsWith('.jpg')).sort().map(file => path.join(captureDirectory, file));
  const distinct = new Set(await Promise.all(files.map(async file => createHash('sha256').update(await readFile(file)).digest('hex')))).size;
  if (distinct < 3) throw new Error('The native GIF did not advance in the captured window.');
  frames.push(...files);
  return { ...sequence, distinctFrames: distinct, screenshot: `${prefix}.png` };
}
function assert(condition, message) { if (!condition) throw new Error(message); }
await setFixture(fixtureA, 'waiting'); await setFixture(fixtureLeft, 'thinking');
await tmuxCommand(['select-pane', '-t', tmux.left]);
await setFixture(fixtureRight, 'happy');
await until(async () => {
  const s = await status();
  return s.targets.find(t => t.target === a.id).state === 'waiting' && s.targets.find(t => t.target === b.id).state === 'thinking';
});
await focus(1);
evidence.push({ check: 'inactive Codex completion did not replace active Claude pane or the direct tab', status: await status(), capture: await capture('v2-tmux-claude') });
console.log('PASS: direct tab / inactive tmux pane isolation');

await setFixture(fixtureRight, 'happy'); await tmuxCommand(['select-pane', '-t', tmux.right]);
const codex = await until(async () => {
  const s = await status(), target = s.targets.find(t => t.target === b.id);
  return target.provider === 'codex' && target.state === 'happy' && s.targets.find(t => t.target === a.id).state === 'waiting' ? target : false;
});
evidence.push({ check: 'pane selection changed only the tmux tab to Codex', status: await status(), capture: await capture('v2-tmux-codex') });
console.log('PASS: actual tmux pane selection -> independent Windows background');

await setFixture(fixtureA, 'concerned');
await until(async () => (await status()).targets.find(t => t.target === a.id).state === 'concerned');
await focus(0);
assert((await status()).targets.find(t => t.target === b.id).provider === 'codex', 'Direct tab changed the tmux tab.');
evidence.push({ check: 'direct reply changed its own profile and left tmux on Codex', status: await status(), capture: await capture('v2-direct-claude') });
console.log('PASS: actual direct hook -> independent Windows background');

const binding = (await status()).tmux.find(row => row.target === b.id);
const client = (await tmuxClients(tmux.socket)).find(row => row.pid === binding.clientPid);
await tmuxCommand(['detach-client', '-t', client.name]);
await until(async () => !(await status()).targets.some(target => target.target === b.id));
const reopened = JSON.parse((await exec(process.execPath, [path.join(root, 'bin/musume.mjs'), 'open', '--home', home, '--mode', 'tmux', '--window', windowName, '--title', 'Musume v2 C - Reattach', '--', '-S', tmux.socket, 'attach-session', '-t', 'musume-demo'], { timeout: 15_000 })).stdout);
await until(async () => (await status()).targets.find(target => target.target === reopened.id)?.run === codex.run);
await focus(1);
evidence.push({ check: 'a new Terminal tab reattached to the same running LLM run', runUnchanged: codex.run, status: await status(), capture: await capture('v2-tmux-reattach', false) });
console.log('PASS: detach / reattach from another native tab');

await setFixture(fixtureA, 'waiting');
await atomicWrite(path.join(home, 'demo', `${fixtureA}.command.json`), JSON.stringify({ close: true }));
await tmuxCommand(['kill-server']);
await until(async () => (await status()).targets.length === 0);
await callController(home, 'stop');
await until(async () => { try { await readFile(path.join(home, 'controller.json')); return false; } catch (error) { return error.code === 'ENOENT'; } });
const restored = parseSettings(await readFile(config.settingsPath, 'utf8'));
assert(isDeepStrictEqual(restored, baseline), 'Original Windows Terminal settings were not restored.');
console.log(`PASS: cleanup restored all ${restored.profiles.list.length} original profiles and other settings`);

const ffmpeg = process.env.TERMINAL_MUSUME_FFMPEG ?? path.join(process.env.HOME, '.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux');
const video = path.join(artifacts, 'windows-terminal-v2.webm');
const encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '4', '-vcodec', 'mjpeg', '-i', 'pipe:0', '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28', '-y', video], { stdio: ['pipe', 'ignore', 'pipe'] });
let errors = ''; encoder.stderr.on('data', data => { errors += data; });
const encoded = new Promise((resolve, reject) => { encoder.once('error', reject); encoder.once('exit', code => code === 0 ? resolve() : reject(new Error(errors))); });
for (const file of frames) if (!encoder.stdin.write(await readFile(file))) await new Promise(resolve => encoder.stdin.once('drain', resolve));
encoder.stdin.end(); await encoded;
const report = { recordedAt: new Date().toISOString(), terminal: 'Windows Terminal 1.24.12741.0', tmux: '3.4', replies: 'Fixture replies through real CLI wrappers and hook subprocesses. No model inference.', video: path.basename(video), fps: 4, frames: frames.length, videoSeconds: frames.length / 4, originalSettingsRestored: true, originalProfileCount: restored.profiles.list.length, evidence };
await writeFile(path.join(artifacts, 'v2-verification.json'), JSON.stringify(report, null, 2));
if (keep) {
  const direct = await openDemo(false), multiplexed = await openDemo(true);
  const descriptor = await until(async () => JSON.parse(await readFile(path.join(home, 'demo', `${multiplexed.id.slice(0, 8)}.tmux.json`), 'utf8')));
  await exec('/usr/bin/tmux', ['-S', descriptor.socket, 'select-pane', '-t', descriptor.right]);
  await atomicWrite(path.join(home, 'demo', 'showcase.json'), JSON.stringify({ direct, multiplexed, descriptor }));
  console.log('Showcase reopened: direct + tmux tabs.');
}
console.log(path.join(artifacts, 'v2-verification.json'));
