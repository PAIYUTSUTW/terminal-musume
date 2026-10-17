import { readFile, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import jsonc from 'jsonc-parser';
import { atomicWrite, readJSON } from './io.mjs';
import { parseSettings, findProfile, patchAppearance } from './windows-terminal.mjs';

function editJSONC(raw, jsonPath, value) {
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const indentation = /\n([\t ]+)\S/.exec(raw)?.[1] ?? '    ';
  const options = value === undefined ? {} : {
    formattingOptions: { insertSpaces: !indentation.includes('\t'), tabSize: indentation.includes('\t') ? 4 : indentation.length, eol: raw.includes('\r\n') ? '\r\n' : '\n' },
  };
  return bom + jsonc.applyEdits(raw.replace(/^\uFEFF/, ''), jsonc.modify(raw.replace(/^\uFEFF/, ''), jsonPath, value, options));
}

export function removeProfileJSONC(raw, index) {
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = raw.replace(/^\uFEFF/, '');
  const array = jsonc.findNodeAtLocation(jsonc.parseTree(source, [], { allowTrailingComma: true }), ['profiles', 'list']);
  const nodes = array?.children;
  if (!nodes?.[index]) return raw;
  // jsonc-parser 3.3.1's last-array-item deletion leaves a closing brace behind
  // in minified JSON. Use exact AST value boundaries and preserve the ']'.
  let start, end;
  if (nodes.length === 1) { start = array.offset + 1; end = array.offset + array.length - 1; }
  else if (index === nodes.length - 1) { start = nodes[index - 1].offset + nodes[index - 1].length; end = nodes[index].offset + nodes[index].length; }
  else { start = nodes[index].offset; end = nodes[index + 1].offset; }
  return bom + source.slice(0, start) + source.slice(end);
}

// One file lock and one serialized writer own every temporary display profile.
export class MultiTerminal {
  #tail = Promise.resolve();
  #handle;
  #owner = randomUUID();
  #closed = false;
  records = new Map();
  preserved = [];
  constructor({ settingsPath, home, baseProfile }) {
    this.settingsPath = path.resolve(settingsPath);
    this.home = path.resolve(home);
    this.baseProfile = baseProfile;
    this.lockPath = `${this.settingsPath}.terminal-musume.lock`;
    const hash = createHash('sha256').update(this.settingsPath.toLowerCase()).digest('hex').slice(0, 12);
    this.journalPath = path.join(this.home, `profiles-${hash}.json`);
  }
  async open() {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    try { this.#handle = await open(this.lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await readJSON(this.lockPath);
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('Settings lock has no valid owner.');
      try { process.kill(owner.pid, 0); throw new Error('Another Terminal Musume process owns these settings.'); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      await unlink(this.lockPath);
      this.#handle = await open(this.lockPath, 'wx', 0o600);
    }
    await this.#handle.writeFile(JSON.stringify({ pid: process.pid, owner: this.#owner }));
    try {
      const raw = await readFile(this.settingsPath, 'utf8');
      const data = parseSettings(raw);
      if (data.useBackgroundImageForWindow || data['experimental.useBackgroundImageForWindow']) throw new Error('Per-profile background mode is required.');
      this.base = structuredClone(findProfile(data, this.baseProfile ?? data.defaultProfile ?? data.profiles?.list?.[0]?.guid).profile);
      const previous = await readJSON(this.journalPath, null);
      if (previous && previous.settingsPath !== this.settingsPath) throw new Error('Profile journal belongs to different settings.');
      for (const record of previous?.records ?? []) this.records.set(record.entry.guid, record);
      for (const guid of [...this.records.keys()]) await this.#remove(guid);
      const backups = path.join(this.home, 'backups');
      await mkdir(backups, { recursive: true, mode: 0o700 });
      await writeFile(path.join(backups, `${Date.now()}-${this.#owner}-settings.json`), await readFile(this.settingsPath, 'utf8'), { flag: 'wx', mode: 0o600 });
      await this.#save();
      return this;
    } catch (error) { await this.#release(); throw error; }
  }
  #queue(fn) {
    if (this.#closed || !this.#handle) return Promise.reject(new Error('Settings writer is closed.'));
    const result = this.#tail.then(fn); this.#tail = result.catch(() => {}); return result;
  }
  async #save() { await atomicWrite(this.journalPath, JSON.stringify({ version: 2, settingsPath: this.settingsPath, records: [...this.records.values()], preserved: this.preserved }, null, 2)); }
  async #edit(fn) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const raw = await readFile(this.settingsPath, 'utf8');
      const next = fn(raw);
      if (next === raw) return false;
      parseSettings(next);
      if (await readFile(this.settingsPath, 'utf8') !== raw) continue;
      await atomicWrite(this.settingsPath, next); return true;
    }
    throw new Error('Terminal settings kept changing; update skipped.');
  }
  create({ guid = `{${randomUUID()}}`, name, commandline, ...appearance }) {
    return this.#queue(async () => {
      const entry = { ...this.base, guid, name, commandline, hidden: true, closeOnExit: 'always', ...appearance };
      delete entry.source; delete entry.updates;
      // Inherit fonts and colours, but an unfocused image must not hide our state.
      if (entry.unfocusedAppearance) {
        entry.unfocusedAppearance = { ...entry.unfocusedAppearance };
        for (const key of Object.keys(entry.unfocusedAppearance)) if (key.startsWith('backgroundImage')) delete entry.unfocusedAppearance[key];
      }
      const record = { entry, lastApplied: {} };
      if (this.records.has(guid)) throw new Error('Managed profile already exists.');
      const existing = parseSettings(await readFile(this.settingsPath, 'utf8')).profiles.list;
      if (existing.some(profile => profile.guid?.toLowerCase() === guid.toLowerCase())) throw new Error('Profile GUID collision.');
      this.records.set(guid, record);
      await this.#save(); // Record intent before touching the real settings.
      try { await this.#edit(raw => editJSONC(raw, ['profiles', 'list', -1], entry)); }
      catch (error) { this.records.delete(guid); await this.#save(); throw error; }
      return structuredClone(entry);
    });
  }
  applyBatch(updates) {
    return this.#queue(async () => {
      const changed = [], rollback = new Map();
      for (const { profile, image, opacity = .38 } of updates) {
        if (!this.records.has(profile)) throw new Error('Only managed profiles may be updated.');
        if (!(opacity >= 0 && opacity <= 1) || typeof image !== 'string' || !image) throw new Error('Invalid background appearance.');
      }
      for (const { profile, image, opacity = .38, alignment = 'bottomRight', stretchMode = 'none' } of updates) {
        const record = this.records.get(profile);
        if (!record) throw new Error('Only managed profiles may be updated.');
        if (!(opacity >= 0 && opacity <= 1) || typeof image !== 'string' || !image) throw new Error('Invalid background appearance.');
        const changes = { backgroundImage: image, backgroundImageOpacity: opacity, backgroundImageAlignment: alignment, backgroundImageStretchMode: stretchMode };
        if (isDeepStrictEqual(changes, record.lastApplied)) continue;
        rollback.set(profile, record.lastApplied); record.lastApplied = changes; changed.push({ profile, changes });
      }
      if (!changed.length) return false;
      await this.#save();
      try {
        return await this.#edit(raw => changed.reduce((text, row) => patchAppearance(text, row.profile, row.changes), raw));
      } catch (error) {
        for (const [profile, previous] of rollback) this.records.get(profile).lastApplied = previous;
        await this.#save(); throw error;
      }
    });
  }
  remove(guid) { return this.#queue(() => this.#remove(guid)); }
  async #remove(guid) {
    const record = this.records.get(guid);
    if (!record) return false;
    let removed = false, preserved = false;
    await this.#edit(raw => {
      const list = parseSettings(raw).profiles.list;
      const index = list.findIndex(profile => profile.guid === guid);
      if (index < 0) return raw;
      const expected = { ...record.entry, ...record.lastApplied };
      if (!isDeepStrictEqual(list[index], expected)) { preserved = true; return raw; }
      removed = true; return removeProfileJSONC(raw, index);
    });
    if (preserved && !this.preserved.includes(guid)) this.preserved.push(guid);
    this.records.delete(guid); await this.#save(); return removed;
  }
  async #release() {
    if (this.#handle) {
      await this.#handle.close(); this.#handle = null;
      const lock = await readJSON(this.lockPath, null);
      if (lock?.owner === this.#owner) await unlink(this.lockPath);
    }
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true; await this.#tail;
    try { for (const guid of [...this.records.keys()]) await this.#remove(guid); }
    finally { await this.#release(); }
  }
}
