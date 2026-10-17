import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeHome } from '../src/runtime-home.mjs';

test('WSL runtime stays in private Linux state storage independently of the checkout', () => {
  const options = { env: {}, platform: 'linux', userHome: '/home/test-user' };
  assert.equal(runtimeHome(options), '/home/test-user/.local/state/terminal-musume/v2');
  assert.equal(runtimeHome({ ...options, scope: '' }), '/home/test-user/.local/state/terminal-musume');
  assert.equal(runtimeHome({ ...options, scope: 'live-demo' }), '/home/test-user/.local/state/terminal-musume/live-demo');
  assert.equal(runtimeHome({ ...options, env: { XDG_STATE_HOME: '/private/state' } }), '/private/state/terminal-musume/v2');
  assert.equal(runtimeHome({ ...options, env: { XDG_STATE_HOME: 'relative-folder' } }), runtimeHome(options));
});

test('an explicit runtime override preserves compatibility with existing hook configurations', () => {
  assert.equal(runtimeHome({ env: { TERMINAL_MUSUME_HOME: '/private/custom' }, platform: 'linux' }), '/private/custom');
});

test('native Windows state uses LocalAppData instead of the source checkout', () => {
  assert.equal(runtimeHome({ env: { LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' }, platform: 'win32', userHome: 'C:\\Users\\Test' }), 'C:\\Users\\Test\\AppData\\Local\\TerminalMusume\\state\\v2');
});
