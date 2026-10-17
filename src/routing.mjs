import { AvatarState } from './state.mjs';
import { createRun, locationKey, validateLocation } from './context.mjs';
import { validateEvent } from './events.mjs';

export class SessionRouter {
  targets = new Map();
  runs = new Map();
  locations = new Map();
  constructor({ reactionMs = 6000, maxAgeMs = 60_000 } = {}) { Object.assign(this, { reactionMs, maxAgeMs }); }

  addTarget({ id, profile, terminal = id, provider = 'claude', ...rest }) {
    if (!id || !profile || this.targets.has(id)) throw new Error('A unique target and profile are required.');
    if ([...this.targets.values()].some(row => row.profile === profile || row.terminal === terminal)) throw new Error('Each target requires its own profile and terminal ID.');
    this.targets.set(id, { ...rest, id, profile, terminal, provider, view: { kind: 'direct', terminal } });
    return this.targets.get(id);
  }
  removeTarget(id) { return this.targets.delete(id); }
  setView(id, location) {
    const target = this.targets.get(id);
    if (!target) throw new Error('Unknown display target.');
    target.view = location === null ? null : validateLocation(location);
  }
  directView(id) {
    const target = this.targets.get(id);
    if (target) target.view = { kind: 'direct', terminal: target.terminal };
  }
  beginRun(input) {
    const value = createRun(input.provider, input.location, input);
    if (this.runs.has(value.run)) throw new Error('Run ID already exists.');
    const key = locationKey(value.location);
    const previous = this.runs.get(this.locations.get(key));
    if (previous && previous.at > value.at) throw new Error('An older run cannot replace a newer run.');
    const record = { ...value, session: null, sessionAt: value.at, ended: false, machine: new AvatarState({ reactionMs: this.reactionMs, maxAgeMs: this.maxAgeMs }) };
    this.runs.set(record.run, record);
    this.locations.set(key, record.run);
    // Bound memory without discarding the currently selected owner of a pane.
    if (this.runs.size > 512) for (const [run, row] of this.runs) {
      if (this.locations.get(locationKey(row.location)) !== run || row.ended) this.runs.delete(run);
      if (this.runs.size <= 384) break;
    }
    return record.run;
  }
  endRun(run) {
    const row = this.runs.get(run);
    if (row) row.ended = true;
  }
  accept(event, now = Date.now(), decision) {
    validateEvent(event);
    const row = this.runs.get(event.run);
    if (!row || row.ended || row.provider !== event.provider || locationKey(event.location) !== locationKey(row.location)
      || this.locations.get(locationKey(row.location)) !== row.run || event.at < row.at || event.at < row.sessionAt) return false;
    if (event.at > now + 5000 || now - event.at > this.maxAgeMs) return false;
    if (!row.session || row.session !== event.session && event.source === 'SessionStart') {
      row.session = event.session; row.sessionAt = event.at;
      row.machine = new AvatarState({ reactionMs: this.reactionMs, maxAgeMs: this.maxAgeMs });
    }
    if (row.session !== event.session) return false;
    return row.machine.apply(event, now, decision);
  }
  project(id, now = Date.now()) {
    const target = this.targets.get(id);
    if (!target) return undefined;
    const row = target.view ? this.runs.get(this.locations.get(locationKey(target.view))) : undefined;
    const active = row && !row.ended ? row.machine.snapshot(now).active : undefined;
    const ready = active?.session ? active : { provider: row?.provider ?? target.provider, state: 'idle', session: '', reason: target.view ? 'no-agent' : 'detached' };
    return { target: id, profile: target.profile, terminal: target.terminal, view: target.view,
      run: row?.ended ? null : row?.run ?? null, ...ready };
  }
  snapshot(now = Date.now()) {
    return { targets: [...this.targets.keys()].map(id => this.project(id, now)),
      runs: [...this.runs.values()].filter(row => !row.ended && this.locations.get(locationKey(row.location)) === row.run)
        .map(row => ({ run: row.run, provider: row.provider, location: row.location, session: row.session, active: row.machine.snapshot(now).active })) };
  }
}
