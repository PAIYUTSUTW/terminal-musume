// Opt-in real-model verification. The descriptor identifies test-only tabs and
// panes that are already open, authenticated, and reviewed in the native CLIs.
// This script submits short, explicitly synthetic test phrases to Codex only.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callController } from '../src/rpc.mjs';
import { powershell, psQuote } from '../src/windows-launch.mjs';
import { parseSettings, toWindowsAssetPath } from '../src/windows-terminal.mjs';
import { tmuxClients } from '../src/tmux.mjs';
import { runtimeHome } from '../src/runtime-home.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { descriptor: { type: 'string', default: path.join(runtimeHome(), 'real-test.json') } } });
const d = JSON.parse(await readFile(values.descriptor, 'utf8'));
const home = d.home ?? runtimeHome();
const exec = promisify(execFile), artifacts = path.join(root, 'artifacts');
const status = () => callController(home, 'status');
const tmux = (...args) => exec('/usr/bin/tmux', ['-S', d.socket, ...args], { timeout: 5000 });
const evidence = [], frames = [];
const target = (s, id) => s.targets.find(row => row.target === id);
const reportFile = path.join(artifacts, 'native-real-routing.json');
const report = { checkedAt: new Date().toISOString(), inference: 'Real Codex CLI model replies; prompts ask for synthetic test phrases, not project test results.', evidence };
async function save() { await writeFile(reportFile, JSON.stringify(report, null, 2)); }
async function until(fn, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await delay(70); }
  throw new Error('Native verification timed out. Inspect the test-only CLI pane for trust, authentication, or usage prompts.');
}
async function capture(prefix, animated = true) {
  const invoke = async args => JSON.parse((await exec('/init', ['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', toWindowsAssetPath(path.join(root, 'scripts/capture-windows-demo.ps1')), '-TitlePattern', '*Musume Real*', '-Prefix', prefix, ...args], { timeout: 15_000 })).stdout);
  const still = await invoke([]);
  const directory = `/mnt/${still.OutputDirectory[0].toLowerCase()}${still.OutputDirectory.slice(2).replaceAll('\\', '/')}`;
  await copyFile(path.join(directory, `${prefix}-00000.png`), path.join(artifacts, `${prefix}.png`));
  if (!animated) return { ...still, screenshot: `${prefix}.png` };
  const sequence = await invoke(['-Frames', '12', '-Fps', '4', '-Format', 'jpg']);
  const files = (await readdir(directory)).filter(name => name.startsWith(`${prefix}-`) && name.endsWith('.jpg')).sort().map(name => path.join(directory, name));
  const distinct = new Set(await Promise.all(files.map(async file => createHash('sha256').update(await readFile(file)).digest('hex')))).size;
  assert.ok(distinct >= 3, 'Native animation must visibly advance.'); frames.push(...files);
  return { ...sequence, distinctFrames: distinct, screenshot: `${prefix}.png` };
}
async function focus(index) {
  await powershell(`Start-Process -FilePath wt.exe -ArgumentList ${psQuote(`--window ${d.window} focus-tab --target ${index}`)}; Start-Sleep -Milliseconds 300`);
}
async function prompt(text) {
  await tmux('send-keys', '-t', d.codex, 'C-u');
  await tmux('send-keys', '-t', d.codex, '-l', text);
  // Codex defers Enter immediately after a large paste.
  await delay(450); await tmux('send-keys', '-t', d.codex, 'Enter');
}
function remember(check, details) { evidence.push({ check, at: new Date().toISOString(), ...details }); console.log(`PASS: ${check}`); }
try {
  const initial = await status();
  const direct = target(initial, d.directTarget), multiplexed = target(initial, d.tmuxTarget);
  assert.ok(direct?.session && multiplexed?.session, 'Open both real sessions before running this verifier.');
  assert.equal(direct.view.kind, 'direct'); assert.equal(multiplexed.view.server, d.socket);
  assert.notEqual(direct.session, multiplexed.session);
  const stable = row => ({ session: row.session, run: row.run, state: row.state, reason: row.reason });
  const directBefore = stable(direct);
  const config = JSON.parse(await readFile(path.join(home, 'controller.json'), 'utf8'));
  const profiles = async () => parseSettings(await readFile(config.settingsPath, 'utf8')).profiles.list;
  const directProfileBefore = (await profiles()).find(row => row.guid === direct.profile);
  await tmux('send-keys', '-t', d.codex, 'Escape');
  await tmux('select-pane', '-t', d.claude);
  await until(async () => target(await status(), d.tmuxTarget).provider === 'claude');
  await focus(d.tmuxTabIndex);
  const phrase = 'This is an avatar integration test, not a request to inspect the project. Do not use any tools. Reply with exactly this unquoted line and nothing else: Test phrase: Some tests failed.';
  const startedAt = Date.now(); await prompt(phrase);
  const thinking = await until(async () => (await status()).runs.find(row => row.location.server === d.socket && row.location.pane === d.codex && row.active.state === 'thinking'));
  const completed = await until(async () => (await status()).runs.find(row => row.run === thinking.run && row.active.state === 'concerned' && row.active.at >= startedAt));
  const inactive = await status();
  assert.equal(target(inactive, d.tmuxTarget).provider, 'claude');
  assert.deepEqual(stable(target(inactive, d.directTarget)), directBefore);
  assert.deepEqual((await profiles()).find(row => row.guid === direct.profile), directProfileBefore);
  remember('Inactive real Codex reply leaves the selected Claude pane and direct profile unchanged', { prompt: phrase, thinking, completed, status: inactive }); await save();

  await tmux('select-pane', '-t', d.codex);
  const selected = await until(async () => { const row = target(await status(), d.tmuxTarget); return row.run === completed.run && row.state === 'concerned' && row; });
  remember('Selecting the Codex pane projects its actual reply into only its Windows Terminal background', { selected, status: await status(), capture: await capture('native-tmux-concerned') }); await save();
  await focus(d.directTabIndex);
  remember('A separate direct Codex session retains its own background', { target: target(await status(), d.directTarget), capture: await capture('native-direct-isolated', false) }); await save();

  const clients = await tmuxClients(d.socket), binding = (await status()).tmux.find(row => row.target === d.tmuxTarget);
  const client = clients.find(row => row.pid === binding.clientPid);
  await tmux('detach-client', '-t', client.name);
  await until(async () => !target(await status(), d.tmuxTarget));
  const reopened = JSON.parse((await exec(process.execPath, [path.join(root, 'bin/musume.mjs'), 'open', '--home', home, '--mode', 'tmux', '--window', d.window, '--title', 'Musume Real C - Reattach', '--', '-S', d.socket, 'attach-session', '-t', 'real'], { timeout: 15_000 })).stdout);
  const reattached = await until(async () => { const row = target(await status(), reopened.id); return row?.run === selected.run && row; });
  assert.equal(reattached.session, selected.session);
  d.tmuxTarget = reopened.id; d.tmuxProfile = reopened.profile; d.tmuxTabIndex = 1; d.directTabIndex = 0;
  await writeFile(values.descriptor, JSON.stringify(d, null, 2));
  remember('A new native tab reattaches to the same running real LLM session', { selected, reattached, capture: await capture('native-tmux-reattach', false) }); await save();
  report.frameFiles = frames;
  report.result = 'passed';
  await save();
  console.log(reportFile);
} catch (error) { report.result = 'failed'; report.error = error.message; await save(); throw error; }
