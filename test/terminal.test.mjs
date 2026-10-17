import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TerminalBackground, parseSettings, patchAppearance, findProfile, toWindowsAssetPath } from '../src/windows-terminal.mjs';

export const fixture = '\uFEFF{\r\n    // Keep this comment\r\n    "theme": "dark",\r\n    "profiles": {"defaults": {"font": {"face":"Cascadia Code"}}, "list": [\r\n        {"guid":"{a}", "name":"Ubuntu", "backgroundImage":"C:\\\\old.gif", "backgroundImageOpacity":0.4,},\r\n        {"guid":"{b}", "name":"PowerShell", "commandline":"pwsh.exe"},\r\n    ]},\r\n}\r\n';

test('JSONC edits preserve comments, BOM, line endings, other profiles, and unrelated settings', () => {
  const next = patchAppearance(fixture, '{a}', { backgroundImage: 'C:\\new.gif', backgroundImageOpacity: .28 });
  assert.ok(next.startsWith('\uFEFF')); assert.ok(next.includes('// Keep this comment\r\n'));
  assert.deepEqual(parseSettings(next).profiles.list[1], parseSettings(fixture).profiles.list[1]);
  assert.deepEqual(parseSettings(next).profiles.defaults, parseSettings(fixture).profiles.defaults);
  assert.equal(findProfile(parseSettings(next), '{a}').profile.backgroundImage, 'C:\\new.gif');
});
test('malformed and ambiguous settings are refused', () => {
  assert.throws(() => patchAppearance('{broken', '{a}', {}), /valid JSONC/);
  assert.throws(() => findProfile({ profiles: { list: [{ name: 'same' }, { name: 'same' }] } }, 'same'), /ambiguous/);
});
test('Windows and WSL paths resolve without spawning Windows processes', () => {
  assert.equal(toWindowsAssetPath('/mnt/c/Users/J/idle.gif'), 'C:\\Users\\J\\idle.gif');
  assert.equal(toWindowsAssetPath('/home/j/idle.gif', { distro: 'Ubuntu' }), '\\\\wsl.localhost\\Ubuntu\\home\\j\\idle.gif');
  assert.equal(toWindowsAssetPath('/src/pack/claude/idle.gif', { packRoot: '/src/pack', windowsRoot: 'D:\\pets' }), 'D:\\pets\\claude\\idle.gif');
  assert.throws(() => toWindowsAssetPath('/tmp/no.gif', { distro: '', platform: 'linux' }), /Cannot infer/);
});
test('background changes restore only owned fields and preserve manual edits', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'musume-settings-'));
  const settingsPath = path.join(dir, 'settings.json');
  try {
    await writeFile(settingsPath, fixture);
    const controller = await new TerminalBackground({ settingsPath, profile: '{a}', home: path.join(dir, 'runtime') }).open();
    try {
      await controller.apply('C:\\pets\\happy.gif');
      const running = parseSettings(await readFile(settingsPath, 'utf8'));
      assert.equal(running.profiles.list[0].backgroundImage, 'C:\\pets\\happy.gif');
      assert.equal(running.profiles.list[0].backgroundImageStretchMode, 'none');
      const edited = patchAppearance(await readFile(settingsPath, 'utf8'), '{a}', { backgroundImageOpacity: .7 });
      await writeFile(settingsPath, edited);
    } finally { await controller.close(); }
    const restored = parseSettings(await readFile(settingsPath, 'utf8'));
    assert.equal(restored.profiles.list[0].backgroundImage, parseSettings(fixture).profiles.list[0].backgroundImage);
    assert.equal(restored.profiles.list[0].backgroundImageOpacity, .7);
    assert.ok(!Object.hasOwn(restored.profiles.list[0], 'backgroundImageStretchMode'));
    assert.deepEqual(restored.profiles.list[1], parseSettings(fixture).profiles.list[1]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('two controllers cannot concurrently rewrite the same settings file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'musume-lock-'));
  const settingsPath = path.join(dir, 'settings.json');
  let first;
  try {
    await writeFile(settingsPath, fixture);
    first = await new TerminalBackground({ settingsPath, profile: '{a}', home: path.join(dir, 'one') }).open();
    await assert.rejects(new TerminalBackground({ settingsPath, profile: '{b}', home: path.join(dir, 'two') }).open(), /Another Terminal Musume/);
  } finally { if (first) await first.close(); await rm(dir, { recursive: true, force: true }); }
});
