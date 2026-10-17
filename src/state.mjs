import { classifyReply } from './classify.mjs';
import { validateEvent } from './events.mjs';

export class AvatarState {
  #sessions = new Map();
  #seen = new Set();
  #active = null;
  constructor({ reactionMs = 6000, busyMs = 180_000, maxAgeMs = 60_000, maxSessions = 64 } = {}) {
    Object.assign(this, { reactionMs, busyMs, maxAgeMs, maxSessions });
  }
  apply(event, now = Date.now(), classification) {
    validateEvent(event);
    if (event.at > now + 5000 || now - event.at > this.maxAgeMs || this.#seen.has(event.id)) return false;
    const key = `${event.provider}:${event.session}`;
    const previous = this.#sessions.get(key);
    if (previous && event.at < previous.at) return false;
    this.#seen.add(event.id);
    if (this.#seen.size > 1024) this.#seen.delete(this.#seen.values().next().value);
    const decision = event.kind === 'reply' ? (classification ?? classifyReply(event.text))
      : { state: event.kind === 'error' ? 'concerned' : event.kind, reason: `lifecycle:${event.source}`, confidence: 1 };
    const duration = ['happy', 'concerned', 'explaining'].includes(decision.state) ? this.reactionMs
      : ['thinking', 'working', 'waiting'].includes(decision.state) ? this.busyMs : 0;
    const record = { provider: event.provider, session: event.session, state: decision.state,
      reason: decision.reason, confidence: decision.confidence, at: event.at, expiresAt: duration ? now + duration : 0 };
    this.#sessions.delete(key);
    this.#sessions.set(key, record);
    if (!this.#active || event.at >= this.#active.at) this.#active = record;
    while (this.#sessions.size > this.maxSessions) this.#sessions.delete(this.#sessions.keys().next().value);
    return true;
  }
  snapshot(now = Date.now()) {
    const expire = row => row.expiresAt && now >= row.expiresAt ? { ...row, state: 'idle', reason: 'reaction-ended', expiresAt: 0 } : { ...row };
    return { active: this.#active ? expire(this.#active) : { provider: 'claude', session: '', state: 'idle', reason: 'ready', at: 0, expiresAt: 0 },
      sessions: [...this.#sessions.values()].map(expire) };
  }
}
