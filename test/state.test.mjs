import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHook } from '../src/events.mjs';
import { AvatarState } from '../src/state.mjs';

test('both documented Stop payloads provide the reply directly', () => {
  for (const provider of ['codex', 'claude']) {
    const event = normalizeHook(provider, { hook_event_name: 'Stop', session_id: 's', last_assistant_message: '完成了。', transcript_path: '/never/read/this' }, { now: 1000, env: {} });
    assert.equal(event.kind, 'reply'); assert.equal(event.text, '完成了。'); assert.equal(event.at, 1000);
    assert.equal(event.transcript_path, undefined);
  }
});
test('legacy Codex notify payload is normalized', () => {
  const event = normalizeHook('codex', { type: 'agent-turn-complete', 'thread-id': 'thread', 'last-assistant-message': 'All tests passed.' });
  assert.equal(event.session, 'thread'); assert.equal(event.kind, 'reply');
});
test('tool failures take priority over tool completion', () => {
  const event = normalizeHook('claude', { hook_event_name: 'PostToolUse', session_id: 's', tool_response: { exit_code: 1 } });
  assert.equal(event.kind, 'error'); assert.equal(event.text, '');
});
test('unrelated notifications and subagents do not animate the main character', () => {
  assert.equal(normalizeHook('claude', { hook_event_name: 'Notification', notification_type: 'auth_success' }), null);
  assert.equal(normalizeHook('codex', { hook_event_name: 'SubagentStop' }), null);
});
test('reactions settle to idle and old events cannot steal focus', () => {
  const state = new AvatarState({ reactionMs: 100 });
  const happy = normalizeHook('claude', { hook_event_name: 'Stop', session_id: 'a', last_assistant_message: '全部測試通過。', turn_id: 't' }, { now: 1000, env: {} });
  assert.equal(state.apply(happy, 1000), true);
  assert.equal(state.snapshot(1050).active.state, 'happy');
  assert.equal(state.apply(happy, 1060), false);
  assert.equal(state.snapshot(1100).active.state, 'idle');
  state.apply(normalizeHook('codex', { hook_event_name: 'UserPromptSubmit', session_id: 'b' }, { now: 1200 }), 1200);
  state.apply(normalizeHook('claude', { hook_event_name: 'Stop', session_id: 'a', last_assistant_message: '請先確認。' }, { now: 1150 }), 1200);
  assert.equal(state.snapshot(1200).active.provider, 'codex');
  assert.equal(state.snapshot(1200).active.state, 'thinking');
});
test('queue replay after restart is ignored; raw replies are not retained', () => {
  const state = new AvatarState({ maxAgeMs: 100 });
  const stale = normalizeHook('codex', { hook_event_name: 'Stop', last_assistant_message: 'secret response' }, { now: 1000 });
  assert.equal(state.apply(stale, 1200), false);
  const fresh = { ...stale, at: 1200 };
  state.apply(fresh, 1200);
  assert.ok(!JSON.stringify(state.snapshot(1200)).includes('secret response'));
});
