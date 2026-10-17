#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { loadPack } from '../src/pack.mjs';
import { TerminalBackground, parseSettings } from '../src/windows-terminal.mjs';
import { startBridge } from '../src/bridge.mjs';
import { atomicWrite } from '../src/io.mjs';
import { runtimeHome } from '../src/runtime-home.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  demo: { type: 'boolean', default: false }, home: { type: 'string', default: runtimeHome({ scope: '' }) },
  pack: { type: 'string', default: path.join(root, 'assets/demo') }, port: { type: 'string', default: '7331' },
  settings: { type: 'string' }, profile: { type: 'string' }, opacity: { type: 'string', default: '.28' },
  provider: { type: 'string' }, output: { type: 'string' }, 'windows-pack-root': { type: 'string' },
  'ollama-model': { type: 'string' }, 'ollama-url': { type: 'string', default: 'http://127.0.0.1:11434' },
} });
const command = positionals[0] ?? 'help';
try {
  if (command === 'profiles') {
    if (!values.settings) throw new Error('Provide --settings <Windows Terminal settings.json>.');
    const data = parseSettings(await readFile(values.settings, 'utf8'));
    console.log(JSON.stringify(data.profiles?.list?.map(({ name, guid }) => ({ name, guid })) ?? [], null, 2));
  } else if (command === 'hooks') {
    const provider = values.provider;
    if (!['claude', 'codex'].includes(provider)) throw new Error('Provide --provider codex or claude.');
    const quote = value => process.platform === 'win32' ? `"${value.replaceAll('"', '\\"')}"` : `'${value.replaceAll("'", "'\\''")}'`;
    // A bare executable works in cmd, PowerShell, and Git Bash. A quoted
    // executable path without PowerShell's call operator is not executable.
    const executable = process.platform === 'win32' ? 'node' : quote(process.execPath);
    const hookCommand = `${executable} ${quote(path.join(root, 'bin/emit-hook.mjs'))} --provider ${provider} --home ${quote(path.resolve(values.home))}`;
    const events = provider === 'codex'
      ? ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd']
      : ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd'];
    const config = { hooks: Object.fromEntries(events.map(event => [event, [{ hooks: [{ type: 'command', command: hookCommand, timeout: 2 }] }]])) };
    const text = JSON.stringify(config, null, 2) + '\n';
    if (values.output) { await atomicWrite(path.resolve(values.output), text); console.log(`Hook fragment written: ${path.resolve(values.output)}`); }
    else process.stdout.write(text);
  } else if (command === 'start') {
    const opacity = Number(values.opacity), port = Number(values.port);
    if (!(opacity >= 0 && opacity <= 1) || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid opacity or port.');
    if (Boolean(values.settings) !== Boolean(values.profile)) throw new Error('--settings and --profile must be provided together.');
    const pack = await loadPack(values.pack);
    let background;
    if (values.settings) background = await new TerminalBackground({ settingsPath: values.settings, profile: values.profile, home: path.resolve(values.home) }).open();
    let bridge;
    try {
      bridge = await startBridge({ home: path.resolve(values.home), pack, background, port, demo: values.demo, opacity,
        windowsPackRoot: values['windows-pack-root'], ollamaModel: values['ollama-model'], ollamaURL: values['ollama-url'] });
    } catch (error) { if (background) await background.close(); throw error; }
    console.log(`Terminal Musume: ${bridge.url}`);
    console.log(background ? `Background attached to ${values.profile}. Ctrl+C restores its original appearance.` : 'Preview only. No Windows Terminal settings changed.');
    if (pack.manifest.sourceKind === 'procedural-svg-demo') console.log('Using original vector placeholders; import Live2D-rendered GIFs for the requested characters.');
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; try { await bridge.close(); } catch (error) { console.error(error.message); process.exitCode = 1; } };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } else console.log(`Terminal Musume\n\n  npm run assets                         Export the placeholder animation pack\n  npm start                              Preview on localhost:7331\n  terminal-musume profiles --settings <file>\n  terminal-musume start --settings <file> --profile <GUID>\n  terminal-musume hooks --provider <codex|claude> --output <file>\n\nAdd --demo to enable preview controls. Real hooks work without --demo.\nUse --pack <folder> for Live2D-rendered GIFs.\nUse --ollama-model <installed-model> for optional local semantic classification.`);
} catch (error) { console.error(`Terminal Musume: ${error.message}`); process.exitCode = 1; }
