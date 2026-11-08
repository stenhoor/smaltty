import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from 'smaltty';

test('the package builds and loads by name', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
