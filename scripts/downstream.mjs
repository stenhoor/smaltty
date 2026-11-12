// The downstream check (ADR 0030, decision 2): this smaltty under its four consumers' own tests. Each consumer is
// checked out at its default branch, pointed at this smaltty, and tested as its CI tests it:
//
//   smaltkit  depends on smaltty: install, typecheck, test; then packed, built against this smaltty, for the apps
//   smaltts   depends on smaltty (its checker and strip tests): install, its pinned packages, test
//   smaltui   gets smaltty through smaltkit (the smaltkit above): install, its pinned packages, typecheck, test (e2e)
//   smaltnb   gets smaltty through smaltkit (the smaltkit above): install, its pinned packages, typecheck, test, e2e
//
// "Pointed at" means the dependency in the checkout's package.json becomes a tarball of this smaltty (`npm pack`, which
// builds dist/ as `prepare` does for a GitHub install), or of that smaltkit, and `npm install` resolves it; nothing is
// pushed anywhere. Each consumer's installed copy is then compared with this build's dist/, so a check that passes on
// the old pin can't pass for the wrong reason.
//
// The apps' end-to-end tests drive headless Chromium with Playwright, which isn't a dependency of any of them: install
// it outside the checkouts and point NODE_PATH at it (as smaltnb's CI does), with its Chromium.
//
//   NODE_PATH=$(npm root -g) node scripts/downstream.mjs              all four, in a temporary folder
//   node scripts/downstream.mjs --work ../downstream                 keep the checkouts there (reused if present)
//   node scripts/downstream.mjs --only smaltkit,smaltts              some of them (smaltui and smaltnb need smaltkit)
//   node scripts/downstream.mjs --ref smaltkit=some-branch           another branch than main
//   node scripts/downstream.mjs --repo smaltnb=/path/to/checkout     clone from a local repository instead of GitHub
//
// Prints a table of what passed; exits with 1 if anything failed. On GitHub Actions the table goes to the job summary.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const pairs = (name) => {
  const out = {};
  args.forEach((a, i) => {
    if (a !== name) return;
    const [k, v] = (args[i + 1] ?? '').split('=');
    if (!k || !v) throw new Error(`${name} takes NAME=VALUE`);
    out[k] = v;
  });
  return out;
};

const ALL = ['smaltkit', 'smaltts', 'smaltui', 'smaltnb'];
const only = opt('--only')?.split(',') ?? ALL;
for (const name of only) if (!ALL.includes(name)) throw new Error(`--only: ${name} isn't one of ${ALL.join(', ')}`);
const refs = { smaltkit: 'main', smaltts: 'main', smaltui: 'main', smaltnb: 'main', ...pairs('--ref') };
const repos = pairs('--repo');
const work = resolve(opt('--work') ?? mkdtempSync(join(tmpdir(), 'smaltty-downstream-')));
mkdirSync(work, { recursive: true });

/** One row per step: consumer, step, passed, seconds. */
const results = [];

function run(cwd, cmd, cmdArgs, env = {}) {
  console.log(`\n$ (${cwd.replace(work, '<work>')}) ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} exited with ${r.status ?? r.signal}`);
}

/** Runs `fn` as one step of `consumer`; a failed step fails the consumer's later steps. */
function step(consumer, name, fn) {
  if (results.some((r) => r.consumer === consumer && !r.passed)) {
    results.push({ consumer, step: name, passed: false, seconds: 0, note: 'not run: an earlier step failed' });
    return;
  }
  const start = performance.now();
  try {
    fn();
    results.push({ consumer, step: name, passed: true, seconds: (performance.now() - start) / 1000 });
  } catch (e) {
    console.error(`\n✗ ${consumer}: ${name}: ${e.message}`);
    results.push({ consumer, step: name, passed: false, seconds: (performance.now() - start) / 1000, note: e.message.split('\n')[0] });
  }
}
const passed = (consumer) => results.some((r) => r.consumer === consumer) && results.every((r) => r.consumer !== consumer || r.passed);

/** `npm pack` in `dir` into the work folder; the tarball's path. */
function pack(dir, name) {
  const out = join(work, 'packs', name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  run(dir, 'npm', ['pack', '--pack-destination', out]);
  const tgz = readdirSync(out).find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error(`npm pack left no tarball in ${out}`);
  return join(out, tgz);
}

/** A fresh checkout of `name` at its ref, in the work folder. */
function checkout(name) {
  const dir = join(work, name);
  rmSync(dir, { recursive: true, force: true });
  const url = repos[name] ? resolve(repos[name]) : `https://github.com/stenhoor/${name}.git`;
  run(work, 'git', ['clone', '--quiet', '--depth', '1', '--branch', refs[name], repos[name] ? `file://${url}` : url, dir]);
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  console.log(`${name}: ${refs[name]} at ${sha}`);
  return { dir, sha };
}

/** Points the dependency `dep` (in whichever of dependencies and devDependencies it is) at a tarball. */
function pointAt(dir, dep, tgz) {
  const path = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  const field = ['dependencies', 'devDependencies'].find((f) => pkg[f]?.[dep]);
  if (!field) throw new Error(`${dir}: no dependency on ${dep}`);
  console.log(`${dep}: ${pkg[field][dep]} → file:${tgz}`);
  pkg[field][dep] = `file:${tgz}`;
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
}

/** The same bytes as this build's dist/*.js in `dir`: the consumer has this smaltty, not its pin. */
function sameSmaltty(dir) {
  for (const f of readdirSync(join(root, 'dist')).filter((f) => f.endsWith('.js'))) {
    const file = join(dir, f);
    if (!existsSync(file)) throw new Error(`${file} is missing`);
    if (readFileSync(file, 'utf8') !== readFileSync(join(root, 'dist', f), 'utf8')) throw new Error(`${file} isn't this smaltty's dist/${f}`);
  }
}

const scriptsOf = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts ?? {};
const shas = {};

// ---------------------------------------------------------------- this smaltty

let smalttyTgz;
step('smaltty', 'npm pack (builds dist/)', () => {
  smalttyTgz = pack(root, 'smaltty');
});

// ---------------------------------------------------------------- smaltkit

let smaltkitTgz;
if (only.includes('smaltkit') && passed('smaltty')) {
  let dir;
  step('smaltkit', 'checkout', () => ({ dir, sha: shas.smaltkit } = checkout('smaltkit')));
  step('smaltkit', 'npm install (this smaltty)', () => {
    pointAt(dir, 'smaltty', smalttyTgz);
    run(dir, 'npm', ['install', '--no-audit', '--no-fund']);
    sameSmaltty(join(dir, 'node_modules', 'smaltty', 'dist'));
  });
  step('smaltkit', 'typecheck', () => run(dir, 'npm', ['run', 'typecheck']));
  step('smaltkit', 'test', () => {
    run(dir, 'npm', ['test']);
    sameSmaltty(join(dir, 'dist', 'smaltty'));
  });
  step('smaltkit', 'npm pack, for the apps', () => {
    smaltkitTgz = pack(dir, 'smaltkit');
  });
}

// ---------------------------------------------------------------- smaltts

if (only.includes('smaltts') && passed('smaltty')) {
  let dir;
  step('smaltts', 'checkout', () => ({ dir, sha: shas.smaltts } = checkout('smaltts')));
  step('smaltts', 'npm install (this smaltty)', () => {
    pointAt(dir, 'smaltty', smalttyTgz);
    run(dir, 'npm', ['install', '--no-audit', '--no-fund']);
    sameSmaltty(join(dir, 'node_modules', 'smaltty', 'dist'));
  });
  step('smaltts', 'pinned packages', () => run(dir, 'node', ['scripts/fetch-packed.mjs']));
  step('smaltts', 'test', () => run(dir, 'npm', ['test']));
}

// ---------------------------------------------------------------- the apps, through that smaltkit

for (const app of ['smaltui', 'smaltnb']) {
  if (!only.includes(app)) continue;
  if (!smaltkitTgz) {
    results.push({ consumer: app, step: 'all', passed: false, seconds: 0, note: 'not run: needs a smaltkit built against this smaltty (--only smaltkit,…)' });
    continue;
  }
  let dir;
  step(app, 'checkout', () => ({ dir, sha: shas[app] } = checkout(app)));
  step(app, 'npm install (smaltkit built against this smaltty)', () => {
    pointAt(dir, 'smaltkit', smaltkitTgz);
    run(dir, 'npm', ['install', '--no-audit', '--no-fund']);
  });
  step(app, 'pinned packages (npm run deps)', () => run(dir, 'npm', ['run', 'deps']));
  step(app, 'typecheck', () => run(dir, 'npm', ['run', 'typecheck']));
  if (app === 'smaltui') {
    step(app, 'test (e2e, Chromium)', () => {
      sameSmaltty(join(dir, 'vendor', 'smaltkit', 'smaltty'));
      run(dir, 'npm', ['test']);
    });
  } else {
    step(app, 'test', () => run(dir, 'npm', ['test']));
    step(app, 'e2e (Chromium)', () => {
      if (!scriptsOf(dir).e2e) throw new Error('no e2e script');
      run(dir, 'npm', ['run', 'e2e']);
    });
  }
}

// ---------------------------------------------------------------- the table

const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const table = [
  `Downstream check: smaltty ${sha}${execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() ? ' (with uncommitted changes)' : ''}`,
  '',
  '| Consumer | Step | Result | Seconds |',
  '| --- | --- | --- | ---: |',
  ...results.map((r) => `| ${r.consumer}${shas[r.consumer] ? ` (${refs[r.consumer]} ${shas[r.consumer]})` : ''} | ${r.step} | ${r.passed ? 'passed' : `**failed**${r.note ? `: ${r.note.replace(/\|/g, '\\|')}` : ''}`} | ${r.seconds.toFixed(0)} |`),
];
console.log(`\n${table.join('\n')}\n`);
console.log(`Checkouts in ${work}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table.join('\n')}\n`);
process.exitCode = results.every((r) => r.passed) ? 0 : 1;
