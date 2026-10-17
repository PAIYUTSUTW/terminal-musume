import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, mkdir, cp, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../src/io.mjs';
import { toWindowsAssetPath } from '../src/windows-terminal.mjs';
import { runtimeHome } from '../src/runtime-home.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const home = runtimeHome({ scope: 'live-demo' });
const config = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'));
const framesRoot = path.join(config.packRoot, '..', 'captures');
const artifacts = path.join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const powershell = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const psArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', toWindowsAssetPath(path.join(root, 'scripts/capture-windows-demo.ps1'))];
const capture = async args => JSON.parse((await exec('/init', [powershell, ...psArgs, ...args], { timeout: 20_000 })).stdout);
const states = [], frames = [];
try {
for (const [order, index] of [1, 3, 4, 6, 7, 8].entries()) {
  const requestedAt = Date.now();
  await atomicWrite(path.join(home, 'command.json'), JSON.stringify({ paused: true, index }));
  let status;
  for (let attempt = 0; attempt < 80; attempt++) {
    status = JSON.parse(await readFile(path.join(home, 'status.json'), 'utf8'));
    if (status.index === index && status.at >= requestedAt && status.state === status.expected) break;
    await delay(100);
  }
  if (status.index !== index || status.at < requestedAt || status.state !== status.expected) throw new Error('The real terminal did not acknowledge the requested action.');
  await delay(1100); // Allow the Terminal settings watcher and GIF decoder to settle.
  const prefix = `live-${order}-${status.provider}-${status.state}`;
  await capture(['-Prefix', prefix, '-Format', 'jpg', '-Frames', '24', '-Fps', '8']);
  const localFrames = (await readdir(framesRoot)).filter(file => file.startsWith(prefix) && file.endsWith('.jpg')).sort().map(file => path.join(framesRoot, file));
  const uniqueFrames = new Set(await Promise.all(localFrames.map(async file => createHash('sha256').update(await readFile(file)).digest('hex')))).size;
  if (uniqueFrames < 3) throw new Error(`Native GIF animation did not change in ${status.provider}:${status.state}.`);
  const still = `windows-terminal-${status.provider}-${status.state}`;
  await capture(['-Prefix', still]);
  await cp(path.join(framesRoot, `${still}-00000.png`), path.join(artifacts, `${still}.png`));
  frames.push(...localFrames);
  states.push({ provider: status.provider, state: status.state, event: status.event, reason: status.reason, uniqueFrames, sampledFrames: localFrames.length });
  await writeFile(path.join(artifacts, 'windows-terminal-capture-progress.json'), JSON.stringify({ recordedAt: new Date().toISOString(), states }, null, 2));
  process.stdout.write(`${status.provider}:${status.state} — ${uniqueFrames}/24 distinct real-window frames\n`);
}
const ffmpeg = process.env.TERMINAL_MUSUME_FFMPEG ?? path.join(process.env.HOME, '.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux');
const video = path.join(artifacts, 'windows-terminal-live.webm');
const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '8', '-vcodec', 'mjpeg', '-i', 'pipe:0', '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28', '-y', video], { stdio: ['pipe', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
const exited = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `FFmpeg exited ${code}`))); });
for (const file of frames) {
  if (!child.stdin.write(await readFile(file))) await new Promise(resolve => child.stdin.once('drain', resolve));
}
child.stdin.end();
await exited;
const report = { recordedAt: new Date().toISOString(), terminal: 'Microsoft.WindowsTerminal 1.24.12741.0', capture: 'Actual Windows desktop window, user32 + System.Drawing.CopyFromScreen', replies: 'Demonstration fixtures through the real emit-hook subprocess; no model inference in this recording', profile: config.profile, fps: 8, videoFrames: frames.length, videoSeconds: frames.length / 8, states };
await writeFile(path.join(artifacts, 'windows-terminal-verification.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${video}\n`);
} finally {
  await atomicWrite(path.join(home, 'command.json'), JSON.stringify({ paused: false, index: 0 }));
}
