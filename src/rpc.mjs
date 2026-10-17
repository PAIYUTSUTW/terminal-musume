import path from 'node:path';
import { readJSON } from './io.mjs';

export async function callController(home, method, params = {}, { timeout = 10_000 } = {}) {
  const config = await readJSON(path.join(home, 'controller.json'));
  const url = new URL(config.url);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Invalid local controller address.');
  const response = await fetch(new URL('/rpc', url), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` }, body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(timeout) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Controller request failed.');
  return result;
}
