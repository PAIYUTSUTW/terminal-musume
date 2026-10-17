import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRouter } from '../src/routing.mjs';
import { normalizeHook } from '../src/events.mjs';

const direct = terminal => ({ kind: 'direct', terminal });
const pane = pane => ({ kind: 'tmux', server: '/tmp/s', serverPid: '123', pane });
function hook(run, location, provider, session, name, text = '', at = 1001) {
  const env = { TERMINAL_MUSUME_RUN: run, ...(location.kind === 'direct' ? { WT_SESSION: location.terminal } : { TMUX: `${location.server},${location.serverPid},0`, TMUX_PANE: location.pane }) };
  return normalizeHook(provider, { hook_event_name: name, session_id: session, last_assistant_message: text }, { env, now: at });
}
function setup() {
  const router = new SessionRouter({ reactionMs: 100 });
  router.addTarget({ id: 'A', profile: 'P-A' }); router.addTarget({ id: 'B', profile: 'P-B' });
  return router;
}
test('multiple tabs and identical provider/session IDs remain isolated by run/location', () => {
  const r = setup();
  r.beginRun({ run: 'a', provider: 'claude', location: direct('A'), at: 1000 });
  r.beginRun({ run: 'b', provider: 'claude', location: direct('B'), at: 1000 });
  r.accept(hook('a', direct('A'), 'claude', 'same-session', 'UserPromptSubmit'), 1001);
  r.accept(hook('b', direct('B'), 'claude', 'same-session', 'Stop', '全部測試通過。'), 1001);
  assert.equal(r.project('A', 1002).state, 'thinking'); assert.equal(r.project('B', 1002).state, 'happy');
  assert.equal(r.project('B', 1101).state, 'idle');
  assert.throws(() => r.addTarget({ id: 'C', profile: 'P-A' }), /own profile/);
});
test('replacing an agent ignores its late events and changing sessions rejects old replies', () => {
  const r = setup();
  r.beginRun({ run: 'old', provider: 'claude', location: direct('A'), at: 1000 });
  r.beginRun({ run: 'new', provider: 'codex', location: direct('A'), at: 1100 });
  assert.equal(r.accept(hook('old', direct('A'), 'claude', 's', 'Stop', '失敗', 1200), 1200), false);
  r.accept(hook('new', direct('A'), 'codex', 'one', 'SessionStart', '', 1200), 1200);
  r.accept(hook('new', direct('A'), 'codex', 'two', 'SessionStart', '', 1300), 1300);
  assert.equal(r.accept(hook('new', direct('A'), 'codex', 'one', 'Stop', '失敗', 1400), 1400), false);
  assert.equal(r.project('A', 1400).session, 'two');
  r.endRun('old'); assert.equal(r.project('A', 1400).provider, 'codex');
  r.endRun('new'); assert.equal(r.project('A', 1400).state, 'idle');
});
test('unregistered, forged-location, mismatched-provider and old events fail closed', () => {
  const r = setup(); r.beginRun({ run: 'a', provider: 'claude', location: direct('A'), at: 1000 });
  for (const event of [hook('unknown', direct('A'), 'claude', 's', 'Stop'), hook('a', direct('B'), 'claude', 's', 'Stop'), hook('a', direct('A'), 'codex', 's', 'Stop'), hook('a', direct('A'), 'claude', 's', 'Stop', '', 999)]) assert.equal(r.accept(event, 1001), false);
});
test('tmux focus selects cached pane state, inactive completions never steal focus, and mirrors fan out', () => {
  const r = setup();
  r.beginRun({ run: 'one', provider: 'claude', location: pane('%1'), at: 1000 });
  r.beginRun({ run: 'two', provider: 'codex', location: pane('%2'), at: 1000 });
  r.setView('A', pane('%1')); r.setView('B', pane('%1'));
  r.accept(hook('one', pane('%1'), 'claude', 's1', 'UserPromptSubmit'), 1001);
  r.accept(hook('two', pane('%2'), 'codex', 's2', 'Stop', '全部測試通過。'), 1001);
  assert.equal(r.project('A', 1002).state, 'thinking'); assert.equal(r.project('B', 1002).state, 'thinking');
  r.setView('A', pane('%2')); assert.equal(r.project('A', 1002).state, 'happy');
  assert.equal(r.project('B', 1002).provider, 'claude');
  r.setView('A', null); assert.equal(r.project('A', 1002).reason, 'detached');
  r.setView('B', pane('%2')); assert.equal(r.project('B', 1002).provider, 'codex');
  assert.ok(!JSON.stringify(r.snapshot(1002)).includes('全部測試通過'));
});
