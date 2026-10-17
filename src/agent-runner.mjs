import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { locationFromEnv, createRun } from './context.mjs';
import { callController } from './rpc.mjs';
import { atomicWrite } from './io.mjs';
import { agentInvocation } from './agent-hooks.mjs';

export async function runAgent({ provider, args = [], home, executable = provider, env = process.env, stdio = 'inherit' }) {
  const location = locationFromEnv(env);
  const run = randomUUID();
  const registration = createRun(provider, location, { run, pid: process.pid });
  const runtime = path.join(home, 'runs', `${run}.json`);
  await callController(home, 'beginRun', registration);
  await atomicWrite(runtime, JSON.stringify(registration));
  try {
    const childArgs = await agentInvocation(provider, args, { home, run });
    const child = spawn(executable, childArgs, { stdio, env: { ...env, TERMINAL_MUSUME_RUN: run, TERMINAL_MUSUME_HOME: home } });
    // Both processes share the foreground terminal process group. It delivers
    // Ctrl+C to the CLI too; keeping the wrapper alive lets an interactive CLI
    // interrupt one turn without losing its registration.
    const handleINT = () => {}, handleTERM = () => child.kill('SIGTERM');
    process.on('SIGINT', handleINT); process.on('SIGTERM', handleTERM);
    try {
      return await new Promise((resolve, reject) => {
        child.once('error', reject); child.once('exit', (code, signal) => resolve({ code: code ?? (signal === 'SIGINT' ? 130 : 1), signal, run }));
      });
    } finally { process.off('SIGINT', handleINT); process.off('SIGTERM', handleTERM); }
  } finally {
    await callController(home, 'endRun', { run }).catch(() => {});
    await unlink(runtime).catch(() => {}); await unlink(path.join(home, 'runs', `${run}-hooks.json`)).catch(() => {});
  }
}
