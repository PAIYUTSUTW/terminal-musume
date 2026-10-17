import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startBridge } from '../src/bridge.mjs';
import { loadPack } from '../src/pack.mjs';
import { TerminalBackground } from '../src/windows-terminal.mjs';
import { LABELS } from '../src/constants.mjs';
import { atomicWrite } from '../src/io.mjs';
import { parseSettings } from '../src/windows-terminal.mjs';
import { removeProfileJSONC } from '../src/multi-terminal.mjs';
import { runtimeHome } from '../src/runtime-home.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const home = runtimeHome({ scope: 'live-demo' });
const config = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'));
const pack = await loadPack(config.packRoot);
const background = await new TerminalBackground({ settingsPath: config.settingsPath, profile: config.profile, home }).open();
const bridge = await startBridge({ home, pack, background, port: 7332, opacity: 0.52, reactionMs: 60_000 });
const sequence = [
  { provider: 'claude', event: 'SessionStart', state: 'idle', title: 'Claude 娘 · 待命', text: '準備好了。角色在文字底下持續呼吸、眨眼。' },
  { provider: 'claude', event: 'UserPromptSubmit', state: 'thinking', title: 'Claude 娘 · 思考', text: '請幫我找出這個函式的問題。' },
  { provider: 'claude', event: 'PreToolUse', state: 'working', title: 'Claude 娘 · 工作中', text: '正在檢查程式碼並執行驗證…' },
  { provider: 'claude', event: 'Stop', state: 'happy', title: 'Claude 娘 · 完成 → 開心', text: '已完成修復，全部測試通過！' },
  { provider: 'claude', event: 'Stop', state: 'concerned', title: 'Claude 娘 · 失敗 → 擔心', text: '目前仍有兩個測試失敗，尚未修復。' },
  { provider: 'claude', event: 'PermissionRequest', state: 'waiting', title: 'Claude 娘 · 等你回覆', text: '需要你的回覆，角色切換為等待動作。' },
  { provider: 'codex', event: 'UserPromptSubmit', state: 'thinking', title: 'Codex 娘 · 思考', text: '接著交給 Codex，角色會隨事件來源切換。' },
  { provider: 'codex', event: 'Stop', state: 'happy', title: 'Codex 娘 · 完成 → 開心', text: '問題已解決，所有測試通過！' },
  { provider: 'codex', event: 'Stop', state: 'concerned', title: 'Codex 娘 · 失敗 → 擔心', text: '驗證失敗，還有錯誤需要處理。' },
  { provider: 'codex', event: 'Stop', state: 'explaining', title: 'Codex 娘 · 解說', text: '這個函式會先驗證輸入，接著更新畫面，最後回傳結果。' },
];
let index = 0, paused = false, stopping = false, lastStep = 0, busy = false;

async function emit(step) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'bin/emit-hook.mjs'), '--provider', step.provider, '--home', home], { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, TERMINAL_MUSUME_DEBUG: '1' } });
    let errors = '';
    child.stderr.on('data', value => { errors += value; });
    child.once('error', reject);
    child.once('exit', code => code === 0 && !errors ? resolve() : reject(new Error(errors || `Hook exit ${code}`)));
    child.stdin.end(JSON.stringify({ hook_event_name: step.event, session_id: 'windows-live-demo', last_assistant_message: step.text }));
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    const active = bridge.machine.snapshot().active;
    if (active.provider === step.provider && active.state === step.state && active.at >= lastStep) return active;
    await delay(100);
  }
  throw new Error(`The live hook did not produce ${step.provider}:${step.state}.`);
}

function render(step, active) {
  const accent = step.provider === 'claude' ? '255;170;100' : '171;194;255';
  const color = `\x1b[38;2;${accent}m`;
  const dim = '\x1b[38;2;151;164;186m';
  process.stdout.write('\x1b[?25l\x1b[2J\x1b[H');
  const lines = [
    `${color}  TERMINAL MUSUME  /  實機展示\x1b[0m`,
    `${dim}  Original Windows Terminal · animated background\x1b[0m`,
    '',
    `  ${color}${step.title}\x1b[0m`,
    '',
    `${dim}  收到的事件\x1b[0m`,
    `  ${step.event}${step.event === 'Stop' ? '  /  last_assistant_message' : ''}`,
    '',
    `${dim}  ${step.event === 'UserPromptSubmit' ? '使用者範例' : '展示範例回覆'}\x1b[0m`,
    `  ${step.text}`,
    '',
    `${dim}  背景動作\x1b[0m`,
    `  ${color}${LABELS[active.state]}\x1b[0m  ←  ${active.reason}`,
    '',
    '  管線：事件 → hook 程序 → 本機分類 → Terminal 背景',
    '',
    `${dim}  這是原版 Terminal 的 GIF 背景。回覆是展示範例。\x1b[0m`,
    `${dim}  暫用原創角色，Live2D 素材留到實機效果確認後。\x1b[0m`,
    '',
    `${dim}  一般終端文字會顯示在角色上方，不需要分割窗格。\x1b[0m`,
  ];
  process.stdout.write(lines.join('\r\n'));
  const height = process.stdout.rows || 32;
  const overlay = ('  stdout > Text stays above the animated background. ').repeat(4).slice(0, Math.max(30, (process.stdout.columns || 108) - 2));
  process.stdout.write(`\x1b[${Math.max(22, height - 8)};1H${dim}${overlay}\x1b[0m`);
  process.stdout.write(`\x1b[${Math.max(24, height - 2)};1H${color}  [Space] ${paused ? '繼續' : '暫停'}   [N] 下一個   [1–0] 指定動作   [Q] 關閉還原\x1b[0m`);
  process.stdout.write(`\x1b[${Math.max(25, height - 1)};1H${dim}  ${String(index + 1).padStart(2, '0')}/${sequence.length} · 每 8 秒切換 · ${paused ? '已暫停' : '循環播放'}\x1b[0m`);
}

async function show(nextIndex) {
  if (busy || stopping) return;
  busy = true;
  try {
    index = (nextIndex + sequence.length) % sequence.length;
    lastStep = Date.now();
    const step = sequence[index];
    const active = await emit(step);
    render(step, active);
    await atomicWrite(path.join(home, 'status.json'), JSON.stringify({ pid: process.pid, index, paused, at: Date.now(), provider: active.provider, state: active.state, expected: step.state, event: step.event, reason: active.reason, profile: config.profile, url: bridge.url }));
  } finally { busy = false; }
}

async function close() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  try {
    await bridge.close();
    const raw = await readFile(config.settingsPath, 'utf8');
    const data = parseSettings(raw);
    const profileIndex = data.profiles.list.findIndex(item => item.guid === config.profile);
    if (profileIndex >= 0) {
      const next = removeProfileJSONC(raw, profileIndex);
      if (await readFile(config.settingsPath, 'utf8') === raw) await atomicWrite(config.settingsPath, next);
    }
  }
  finally {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write('\x1b[?25h\x1b[0m\x1b[2J\x1b[H展示已結束，背景設定已還原。\r\n');
    await unlink(path.join(home, 'status.json')).catch(() => {});
    process.exit(0);
  }
}

const timer = setInterval(async () => {
  try {
    const command = JSON.parse(await readFile(path.join(home, 'command.json'), 'utf8'));
    await unlink(path.join(home, 'command.json'));
    if (command.action === 'close') return close();
    if (typeof command.paused === 'boolean') paused = command.paused;
    if (Number.isInteger(command.index)) return show(command.index);
    render(sequence[index], bridge.machine.snapshot().active);
  } catch (error) { if (error.code !== 'ENOENT') process.stderr.write(`${error.message}\r\n`); }
  if (!paused && Date.now() - lastStep >= 8000) show(index + 1).catch(error => { process.stderr.write(`${error.message}\r\n`); close(); });
}, 200);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', data => {
  const key = data.toString().toLowerCase();
  if (['q', '\x03', '\x04'].includes(key)) return close();
  if (key === ' ') { paused = !paused; render(sequence[index], bridge.machine.snapshot().active); }
  if (key === 'n') show(index + 1).catch(console.error);
  if (/^[0-9]$/.test(key)) show(key === '0' ? 9 : Number(key) - 1).catch(console.error);
});
process.stdout.on('resize', () => render(sequence[index], bridge.machine.snapshot().active));
process.on('SIGINT', close);
process.on('SIGTERM', close);
await show(0);
