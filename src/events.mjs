import { createHash, randomUUID } from 'node:crypto';
import { PROVIDERS } from './constants.mjs';
import { hookIdentity, validateLocation } from './context.mjs';

const KINDS = new Map([
  ['SessionStart', 'idle'], ['SessionEnd', 'idle'], ['Interrupt', 'idle'],
  ['UserPromptSubmit', 'thinking'], ['PreToolUse', 'working'], ['PostToolUse', 'working'],
  ['PostToolUseFailure', 'error'], ['StopFailure', 'error'], ['PermissionRequest', 'waiting'],
  ['Stop', 'reply'], ['agent-turn-complete', 'reply'], ['MessageDisplay', 'reply'],
]);

export function normalizeHook(provider, payload, { now = Date.now(), env = process.env } = {}) {
  if (!PROVIDERS.includes(provider)) throw new Error('Agent must be codex or claude.');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Hook input must be a JSON object.');
  if (payload.agent_id || payload.parent_tool_use_id) return null;
  const name = payload.hook_event_name ?? payload.type;
  let kind = KINDS.get(name);
  if (name === 'Notification' && ['permission_prompt', 'idle_prompt', 'elicitation_dialog'].includes(payload.notification_type)) kind = 'waiting';
  if (!kind) return null;
  if (name === 'PostToolUse' && (payload.tool_response?.success === false || Number(payload.tool_response?.exit_code ?? payload.tool_response?.exitCode ?? 0) !== 0)) kind = 'error';
  // The Stop payload supplies the reply directly in current documented versions.
  // No transcript scanning, hidden reasoning, terminal scraping, or tool output.
  const text = kind === 'reply' ? String(payload.last_assistant_message ?? payload['last-assistant-message'] ?? payload.message ?? '').slice(-24_000) : '';
  const session = String(payload.session_id ?? payload['thread-id'] ?? env.WT_SESSION ?? 'manual').slice(0, 200);
  const turn = payload.turn_id ?? payload['turn-id'];
  const identity = hookIdentity(payload, env);
  if (identity && !payload.session_id && !payload['thread-id']) throw new Error('A routed hook requires an LLM session ID.');
  const id = turn && kind === 'reply'
    ? createHash('sha256').update(JSON.stringify([identity?.run, provider, session, turn, name, text])).digest('hex')
    : randomUUID();
  return { id, provider, session, kind, text, at: now, source: String(name), ...(identity ?? {}), ...(env.WT_PROFILE_ID ? { terminalProfile: env.WT_PROFILE_ID } : {}) };
}

export function validateEvent(event) {
  if (!event || typeof event !== 'object' || !PROVIDERS.includes(event.provider)) throw new Error('Invalid event agent.');
  if (!['idle', 'thinking', 'working', 'waiting', 'error', 'reply'].includes(event.kind)) throw new Error('Invalid event kind.');
  if (typeof event.session !== 'string' || !event.session || event.session.length > 200) throw new Error('Invalid session id.');
  if (typeof event.id !== 'string' || !event.id || event.id.length > 200) throw new Error('Invalid event id.');
  if (!Number.isFinite(event.at) || event.at < 0) throw new Error('Invalid event timestamp.');
  if (typeof event.text !== 'string' || event.text.length > 24_000) throw new Error('Invalid event reply.');
  if (event.run !== undefined) {
    if (typeof event.run !== 'string' || !event.run || event.run.length > 512) throw new Error('Invalid run ID.');
    validateLocation(event.location);
  }
  return event;
}
