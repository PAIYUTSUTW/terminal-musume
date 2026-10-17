import { readFile, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import jsonc from 'jsonc-parser';
import { atomicWrite, readJSON } from './io.mjs';
import { APPEARANCE_KEYS } from './constants.mjs';

const { parse, modify, applyEdits } = jsonc;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (object, key) => Object.hasOwn(object, key);

export function parseSettings(raw) {
  const errors = [];
  const data = parse(raw.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Windows Terminal settings are not valid JSONC; no settings were changed.');
  return data;
}

export function findProfile(data, selector) {
  if (!Array.isArray(data.profiles?.list)) throw new Error('Expected profiles.list in Windows Terminal settings.');
  const matches = data.profiles.list.map((profile, index) => ({ profile, index }))
    .filter(({ profile }) => [profile.guid, profile.name].some(value => typeof value === 'string' && value.toLowerCase() === String(selector).toLowerCase()));
  if (matches.length !== 1) throw new Error(matches.length ? 'Profile name is ambiguous; select its GUID.' : `Terminal profile not found: ${selector}`);
  return matches[0];
}

export function patchAppearance(raw, selector, changes) {
  const data = parseSettings(raw);
  const { index } = findProfile(data, selector);
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  let text = raw.replace(/^\uFEFF/, '');
  const indentation = /\n([\t ]+)\S/.exec(text)?.[1] ?? '    ';
  const formattingOptions = { insertSpaces: !indentation.includes('\t'), tabSize: indentation.includes('\t') ? 4 : indentation.length, eol: raw.includes('\r\n') ? '\r\n' : '\n' };
  for (const key of APPEARANCE_KEYS) {
    if (!own(changes, key)) continue;
    text = applyEdits(text, modify(text, ['profiles', 'list', index, key], changes[key], { formattingOptions }));
  }
  return bom + text;
}

export function toWindowsAssetPath(file, { windowsRoot, packRoot, distro = process.env.WSL_DISTRO_NAME, platform = process.platform } = {}) {
  if (windowsRoot) return path.win32.join(windowsRoot, ...path.relative(packRoot, file).split(path.sep));
  if (platform === 'win32' || /^[a-z]:[\\/]/i.test(file) || file.startsWith('\\\\')) return file;
  const mounted = /^\/mnt\/([a-z])\/(.*)$/i.exec(file);
  if (mounted) return `${mounted[1].toUpperCase()}:\\${mounted[2].replaceAll('/', '\\')}`;
  if (distro) return `\\\\wsl.localhost\\${distro}\\${file.replace(/^\//, '').replaceAll('/', '\\')}`;
  throw new Error('Cannot infer the Windows asset path. Set --windows-pack-root to the same pack folder as Windows sees it.');
}

export class TerminalBackground {
  #lock;
  #record;
  #closed = false;
  constructor({ settingsPath, profile, home }) {
    this.settingsPath = path.resolve(settingsPath);
    this.profile = profile;
    const hash = createHash('sha256').update(this.settingsPath.toLowerCase()).digest('hex').slice(0, 12);
    // A file-level lock also serializes two avatars targeting different profiles.
    this.lockPath = `${this.settingsPath}.terminal-musume.lock`;
    this.journalPath = path.join(home, `background-${hash}.json`);
    this.backupRoot = path.join(home, 'backups');
  }
  async open() {
    await mkdir(path.dirname(this.journalPath), { recursive: true, mode: 0o700 });
    try { this.#lock = await open(this.lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await readJSON(this.lockPath).catch(() => ({}));
      if (Number.isInteger(owner.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); throw new Error('Another Terminal Musume process owns these settings.'); }
        catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      } else throw new Error('Terminal Musume lock has no valid owner; inspect the lock before removing it.');
      await unlink(this.lockPath);
      this.#lock = await open(this.lockPath, 'wx', 0o600);
    }
    await this.#lock.writeFile(JSON.stringify({ pid: process.pid }));
    try {
      // Recover only our previous appearance fields, not the whole settings file.
      const previous = await readJSON(this.journalPath, null);
      if (previous && !previous.restored) {
        if (previous.settingsPath !== this.settingsPath) throw new Error('Recovery journal belongs to different settings.');
        await this.#restoreRecord(previous);
      }
      const raw = await readFile(this.settingsPath, 'utf8');
      const data = parseSettings(raw);
      if (data.useBackgroundImageForWindow === true) throw new Error('useBackgroundImageForWindow is enabled. This prototype controls a profile background; use a profile background first.');
      const { profile } = findProfile(data, this.profile);
      const original = Object.fromEntries(APPEARANCE_KEYS.map(key => [key, { present: own(profile, key), ...(own(profile, key) ? { value: profile[key] } : {}) }]));
      this.#record = { version: 1, settingsPath: this.settingsPath, profile: profile.guid ?? profile.name, original, lastApplied: {}, restored: false };
      this.profile = this.#record.profile;
      await mkdir(this.backupRoot, { recursive: true, mode: 0o700 });
      this.backupPath = path.join(this.backupRoot, `${Date.now()}-settings.json`);
      await writeFile(this.backupPath, raw, { flag: 'wx', mode: 0o600 });
      await atomicWrite(this.journalPath, JSON.stringify(this.#record, null, 2));
      return this;
    } catch (error) { await this.#release(); throw error; }
  }
  async #edit(compute) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const raw = await readFile(this.settingsPath, 'utf8');
      const next = compute(raw);
      if (next === raw) return false;
      // Do not overwrite edits observed since reading. Terminal itself does not
      // expose a compare-and-swap API; the final rename remains best effort.
      if (await readFile(this.settingsPath, 'utf8') !== raw) continue;
      await atomicWrite(this.settingsPath, next);
      return true;
    }
    throw new Error('Terminal settings kept changing; background update skipped.');
  }
  async apply(image, { opacity = 0.28, alignment = 'bottomRight', stretchMode = 'none' } = {}) {
    if (!this.#record || this.#closed) throw new Error('Background is not attached.');
    if (!(opacity >= 0 && opacity <= 1)) throw new Error('Opacity must be between 0 and 1.');
    const changes = { backgroundImage: image, backgroundImageOpacity: opacity, backgroundImageAlignment: alignment, backgroundImageStretchMode: stretchMode };
    if (same(changes, this.#record.lastApplied)) return false;
    const previous = this.#record.lastApplied;
    this.#record.lastApplied = changes;
    await atomicWrite(this.journalPath, JSON.stringify(this.#record, null, 2));
    try { return await this.#edit(raw => patchAppearance(raw, this.profile, changes)); }
    catch (error) {
      this.#record.lastApplied = previous;
      await atomicWrite(this.journalPath, JSON.stringify(this.#record, null, 2));
      throw error;
    }
  }
  async #restoreRecord(record) {
    await this.#edit(raw => {
      const { profile } = findProfile(parseSettings(raw), record.profile);
      const changes = {};
      for (const key of APPEARANCE_KEYS) {
        // Preserve any field the user changed while we were running.
        if (own(record.lastApplied, key) && own(profile, key) && same(profile[key], record.lastApplied[key])) {
          changes[key] = record.original[key].present ? record.original[key].value : undefined;
        }
      }
      return patchAppearance(raw, record.profile, changes);
    });
    await atomicWrite(this.journalPath, JSON.stringify({ ...record, restored: true }, null, 2));
  }
  async #release() {
    if (this.#lock) { await this.#lock.close(); this.#lock = null; await unlink(this.lockPath).catch(() => {}); }
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    try { if (this.#record) await this.#restoreRecord(this.#record); }
    finally { await this.#release(); }
  }
}
