// The last step of `npm run build`: the built-in types prepared (milestone 11). It writes dist/builtins-prepared.js
// again, with prepare()'s buffer for builtins.ts's declarations (base64), made by the dist/ just built, so the buffer
// is this smaltty's own: same format, same version. src/builtins-prepared.ts, which tsc built it from, has none.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist');
const { prepare } = await import(join(dist, 'prepared.js'));
const { BUILTINS, BUILTINS_PATH } = await import(join(dist, 'builtins.js'));
const buffer = prepare(new Map([[BUILTINS_PATH, BUILTINS]]));
const base64 = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString('base64');
const file = join(dist, 'builtins-prepared.js');
const before = readFileSync(file, 'utf8');
if (!before.includes('BUILTINS_PREPARED = undefined')) throw new Error('dist/builtins-prepared.js is not the module tsc built');
writeFileSync(file, `export const BUILTINS_PREPARED = ${JSON.stringify(base64)};\n`);
rmSync(`${file}.map`, { force: true });
console.log(`prepare-builtins: ${buffer.byteLength} bytes prepared from ${BUILTINS.length} characters`);
