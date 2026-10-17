import test from 'node:test';
import assert from 'node:assert/strict';
import { locationFromEnv, locationKey } from '../src/context.mjs';
import { normalizeHook } from '../src/events.mjs';

test('direct location retains terminal and LLM session as separate identities', () => {
  const event = normalizeHook('codex', { hook_event_name: 'Stop', session_id: 'llm-1' }, { env: { WT_SESSION: 'tab-A', TERMINAL_MUSUME_RUN: 'run-1' } });
  assert.equal(event.session, 'llm-1'); assert.equal(event.run, 'run-1');
  assert.deepEqual(event.location, { kind: 'direct', terminal: 'tab-A' });
});
test('tmux socket/pid/pane wins over stale outer terminal and handles commas in socket paths', () => {
  const env = { TMUX: '/tmp/a,b/socket,124,0', TMUX_PANE: '%7', WT_SESSION: 'stale-tab', TERMINAL_MUSUME_TERMINAL: 'also-stale' };
  assert.deepEqual(locationFromEnv(env), { kind: 'tmux', server: '/tmp/a,b/socket', serverPid: '124', pane: '%7' });
  assert.notEqual(locationKey(locationFromEnv(env)), locationKey(locationFromEnv({ ...env, TMUX: '/tmp/a,b/socket,125,0' })));
});
test('broken tmux identity fails closed instead of using inherited WT_SESSION', () => {
  assert.throws(() => locationFromEnv({ TMUX: 'bad', TMUX_PANE: '%2', WT_SESSION: 'tab-A' }), /TMUX/);
  assert.throws(() => locationFromEnv({}), /terminal/);
  assert.throws(() => normalizeHook('codex', { hook_event_name: 'Stop' }, { env: { TERMINAL_MUSUME_RUN: 'r', WT_SESSION: 't' } }), /LLM session/);
});
test('subagent lifecycle and tool events cannot take over their parent avatar', () => {
  assert.equal(normalizeHook('claude', { hook_event_name: 'PreToolUse', session_id: 's', agent_id: 'child' }), null);
});
test('the same resumed LLM turn has different identities in different runs', () => {
  const payload = { hook_event_name: 'Stop', session_id: 's', turn_id: 'turn', last_assistant_message: 'Done.' };
  const a = normalizeHook('codex', payload, { env: { WT_SESSION: 'A', TERMINAL_MUSUME_RUN: 'one' } });
  const b = normalizeHook('codex', payload, { env: { WT_SESSION: 'B', TERMINAL_MUSUME_RUN: 'two' } });
  assert.notEqual(a.id, b.id);
});
