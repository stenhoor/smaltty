// From smaltts docs/REFERENCE.md, line 32.
import { Database } from 'smaltdb/engine';
import { attach } from '../src/index.js';
import { registerSmaltts } from '../src/language.js';

registerSmaltts();
const db = attach(Database.openMemory());
