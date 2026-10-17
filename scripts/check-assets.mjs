import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../src/pack.mjs';
import { STATES, PROVIDERS } from '../src/constants.mjs';

const root = fileURLToPath(new URL('../assets/demo/', import.meta.url));
const pack = await loadPack(root);
for (const provider of PROVIDERS) for (const state of STATES) {
  const bytes = await readFile(pack.providers[provider][state].file);
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  if (width !== 360 || height !== 520 || bytes.at(-1) !== 0x3b) throw new Error(`Invalid GIF: ${provider}/${state}`);
}
console.log(`Validated ${PROVIDERS.length * STATES.length} transparent animation slots and their manifest.`);
