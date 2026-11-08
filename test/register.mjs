// `node --import ./test/register.mjs …` runs .ts files through smaltty's stripper instead of Node's built-in type
// stripping: `npm run test:self` runs the test suite this way, so the stripped code is also run, not only compared.
import { register } from 'node:module';

register('./strip-hooks.mjs', import.meta.url);
