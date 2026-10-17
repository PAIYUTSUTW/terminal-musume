import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { writeWrappers } from '../src/windows-launch.mjs';

test('private wrappers avoid cross-runtime recursion and supply Node to non-interactive WSL shells', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'musume-wrapper-'));
  const originalPATH = process.env.PATH;
  try {
    const native = path.join(dir, 'native'), a = path.join(dir, 'A'), b = path.join(dir, 'B');
    await mkdir(native);
    for (const name of ['codex', 'claude', 'tmux']) await writeFile(path.join(native, name), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    process.env.PATH = `${native}:${originalPATH}`;
    await writeWrappers(a);
    process.env.PATH = `${path.join(a, 'bin')}:${native}:${originalPATH}`;
    await writeWrappers(b);
    const executables = JSON.parse(await readFile(path.join(b, 'executables.json'), 'utf8'));
    for (const name of ['codex', 'claude', 'tmux']) assert.equal(executables[name], path.join(native, name));
    const result = await promisify(execFile)(path.join(b, 'bin/node'), ['-p', 'process.version'], { env: { PATH: `${path.join(b, 'bin')}:/usr/bin:/bin` } });
    assert.equal(result.stdout.trim(), process.version);
  } finally { process.env.PATH = originalPATH; await rm(dir, { recursive: true, force: true }); }
});
