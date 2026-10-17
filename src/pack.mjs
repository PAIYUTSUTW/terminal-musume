import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { STATES, PROVIDERS } from './constants.mjs';

export async function loadPack(root) {
  root = path.resolve(root);
  const manifest = JSON.parse(await readFile(path.join(root, 'pack.json'), 'utf8'));
  if (manifest.version !== 1 || typeof manifest.name !== 'string') throw new Error('Invalid animation pack.');
  const providers = {};
  for (const provider of PROVIDERS) {
    const slots = manifest.providers?.[provider];
    if (!slots?.idle) throw new Error(`Animation pack needs ${provider}.idle.`);
    providers[provider] = {};
    for (const state of STATES) {
      const relative = slots[state] ?? slots.idle;
      if (typeof relative !== 'string' || path.isAbsolute(relative) || /^[a-z]:|^\\\\/i.test(relative)) throw new Error('Pack images must be relative local GIF paths.');
      const absolute = path.resolve(root, relative);
      if (!absolute.startsWith(root + path.sep) || !absolute.toLowerCase().endsWith('.gif')) throw new Error('Pack image path must stay inside the animation pack.');
      const info = await stat(absolute);
      if (!info.isFile() || info.size > 50 * 1024 * 1024) throw new Error('Invalid or oversized GIF.');
      const signature = (await readFile(absolute)).subarray(0, 6).toString('ascii');
      if (!['GIF87a', 'GIF89a'].includes(signature)) throw new Error('Animation slot is not a GIF.');
      providers[provider][state] = { file: absolute, relative: relative.replaceAll(path.sep, '/') };
    }
  }
  return { root, manifest, providers };
}
