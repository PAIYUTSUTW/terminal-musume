import test from 'node:test';
import assert from 'node:assert/strict';
import { tmuxSocket } from '../src/tmux.mjs';
test('tmux global flags select the server without mixing client or pane environment', () => {
  assert.equal(tmuxSocket(['-S', './server', 'attach'], {}, '/tmp/example'), '/tmp/example/server');
  assert.equal(tmuxSocket(['-Lwork', 'new'], { TMUX_TMPDIR: '/run/user/test' }), `/run/user/test/tmux-${process.getuid()}/work`);
  assert.equal(tmuxSocket(['-f', '/tmp/custom.conf', '-C', '-S/tmp/socket', 'attach']), '/tmp/socket');
  assert.throws(() => tmuxSocket(['-L']), /value/);
});
