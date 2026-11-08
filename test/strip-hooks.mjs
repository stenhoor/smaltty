// Module hooks: .ts files are loaded as smaltty's stripped JavaScript. Counts what it stripped in
// SMALTTY_STRIPPED_LOG, when set, so a run can show it really went through here.
import { appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { strip } from '../dist/index.js';

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !/\.[mc]?ts$/.test(url) || /\.d\.[mc]?ts$/.test(url)) return nextLoad(url, context);
  const path = fileURLToPath(url);
  const source = strip(await readFile(path, 'utf8'), { fileName: path });
  if (process.env.SMALTTY_STRIPPED_LOG) appendFileSync(process.env.SMALTTY_STRIPPED_LOG, path + '\n');
  return { format: 'module', source, shortCircuit: true };
}
