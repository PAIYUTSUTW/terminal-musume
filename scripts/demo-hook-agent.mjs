#!/usr/bin/env node
// Fixture CLI for repeatable real-device tests. This program does not call an LLM.
import { readFile, unlink, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../src/io.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args[args.indexOf(name) + 1] && args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const id = option('--fixture-id', 'demo');
if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid demo ID.');
const provider = option('--fixture-provider', 'claude');
const home = process.env.TERMINAL_MUSUME_HOME;
const directory = path.join(home, 'demo');
await mkdir(directory, { recursive: true, mode: 0o700 });
const session = `fixture-${id}`;
const examples = {
  thinking: ['UserPromptSubmit', '請檢查這個函式的問題。'],
  working: ['PreToolUse', '正在執行驗證…'],
  happy: ['Stop', '已完成修復，全部測試通過！'],
  concerned: ['Stop', '目前仍有兩個測試失敗，尚未修復。'],
  waiting: ['PermissionRequest', '請確認下一步。'],
  explaining: ['Stop', '這個函式會先驗證輸入，接著更新畫面。'],
};
let state = option('--fixture-state', 'thinking'), busy = false, closed = false;
function render() {
  const color = provider === 'claude' ? '\x1b[38;2;255;170;100m' : '\x1b[38;2;171;194;255m';
  const dim = '\x1b[38;2;151;164;186m';
  const lines = [
    `${color}  TERMINAL MUSUME v2\x1b[0m`,
    `${dim}  Real Windows Terminal / fixture CLI\x1b[0m`, '',
    `  Agent: ${provider}    State: ${color}${state}\x1b[0m`,
    `  LLM session: ${session}`,
    `  Run: ${process.env.TERMINAL_MUSUME_RUN.slice(0, 8)}`,
    `  Location: ${process.env.TMUX_PANE ? `tmux pane ${process.env.TMUX_PANE}` : 'direct terminal'}`,
    '', `  ${examples[state][0]}`, '', `  ${examples[state][1]}`, '',
    `${dim}  使用範例回覆，沒有啟動模型推論。\x1b[0m`,
    `${dim}  事件經真實 hook、路由與 profile 背景。\x1b[0m`, '',
    '  [1] Think  [2] Happy  [3] Concerned',
    '  [4] Wait   [5] Work   [6] Explain',
    '  [Q] Close this fixture',
  ];
  process.stdout.write('\x1b[?25l\x1b[2J\x1b[H' + lines.join('\r\n'));
  const row = Math.max(21, (process.stdout.rows || 30) - 5);
  process.stdout.write(`\x1b[${row};1H${dim}${('  stdout > Text above the animated background. ').repeat(4).slice(0, Math.max(30, (process.stdout.columns || 80) - 2))}\x1b[0m`);
}
async function show(next) {
  if (busy || closed || !examples[next]) return;
  busy = true;
  try {
    state = next; const [event, text] = examples[state];
    const child = spawn(process.execPath, [path.join(root, 'bin/emit-hook.mjs'), '--provider', provider, '--home', home], { env: process.env, stdio: ['pipe', 'ignore', 'inherit'] });
    child.stdin.end(JSON.stringify({ hook_event_name: event, session_id: session, last_assistant_message: text }));
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Fixture hook failed.'))); });
    render();
    await atomicWrite(path.join(directory, `${id}.status.json`), JSON.stringify({ id, provider, session, state, pane: process.env.TMUX_PANE ?? null, run: process.env.TERMINAL_MUSUME_RUN, pid: process.pid }));
  } finally { busy = false; }
}
const timer = setInterval(async () => {
  try {
    const file = path.join(directory, `${id}.command.json`);
    const command = JSON.parse(await readFile(file, 'utf8')); await unlink(file);
    if (command.close) return close();
    await show(command.state);
  } catch (error) { if (error.code !== 'ENOENT') process.stderr.write(error.message + '\r\n'); }
}, 100);
function close() {
  if (closed) return; closed = true; clearInterval(timer);
  process.stdout.write('\x1b[?25h\x1b[0m');
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
}
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', data => {
  const key = data.toString().toLowerCase();
  if (['q', '\x03', '\x04'].includes(key)) return close();
  const next = ['thinking', 'happy', 'concerned', 'waiting', 'working', 'explaining'][Number(key) - 1];
  if (next) show(next).catch(console.error);
});
process.stdout.on('resize', render);
process.on('SIGTERM', close);
await show(state);
