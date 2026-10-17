#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeHook } from '../src/events.mjs';
import { enqueue } from '../src/io.mjs';
import { runtimeHome } from '../src/runtime-home.mjs';

const options = { provider: { type: 'string' }, home: { type: 'string' }, event: { type: 'string' }, text: { type: 'string' }, session: { type: 'string' } };
try {
  const { values, positionals } = parseArgs({ options, allowPositionals: true });
  let input;
  if (values.event) input = { hook_event_name: values.event, last_assistant_message: values.text ?? '', session_id: values.session ?? 'manual' };
  else if (positionals[0]) input = JSON.parse(positionals[0]);
  else {
    let buffer = '';
    for await (const chunk of process.stdin) {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 1024 * 1024) throw new Error('Hook input is too large.');
    }
    input = JSON.parse(buffer);
  }
  const event = normalizeHook(values.provider, input);
  const home = path.resolve(values.home ?? runtimeHome({ scope: '' }));
  if (event) await enqueue(home, event);
} catch (error) {
  if (process.env.TERMINAL_MUSUME_DEBUG === '1') process.stderr.write(`Terminal Musume: ${error.message}\n`);
}
// Observation hooks never block/continue the agent or inject conversation text.
process.stdout.write('{}\n');
