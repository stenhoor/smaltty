# Status

**In development.** smaltty is 0.14.0 (milestone 13; 0.9.0 shipped in smaltworks 0.9.0) and not on npm yet. The plan and its order are in [Milestones](../MILESTONES).

| Milestone | Status |
| --- | --- |
| 1. Scaffold and baseline | Done |
| 2. Scanner and parser | Done |
| 3. Stripper | Done |
| 4. smaltui moves over | Done: smaltui's TypeScript tabs strip types with smaltty |
| 5. Binder | Done |
| 6. smaltnb moves over | Done: smaltnb runs no TypeScript compiler (confirmed 2026-11-12) |
| 7. Checker trial | Done |
| 8. Checking in the apps | Done: smaltui and smaltnb mark type errors as warnings |
| 9. TypeScript 7 as the reference | Done, 2026-11-12: the checker is compared with TypeScript 7, and a downstream check runs the consumers' tests ([ADR 0029](../adr/0029-after-the-checker-trial), [ADR 0030](../adr/0030-changing-smaltty-without-breaking-its-consumers)). Released as 0.10.0 |
| 10. Entry points and size | Released as 0.11.0: `smaltty/strip`, `smaltty/bind` and `smaltty/check`; the stripping path is 24.5 KB gzipped. The apps load the checker only in its worker once they take smaltkit's change |
| 11. Prepared declarations | Released as 0.12.0: `prepare()`, and `check()`'s `prepared`; the built-in types prepared when smaltty is built. With the checker's worker warmed while the page is idle, a page's first check takes 9–14 ms (from 21–71 ms) |
| 12. Incremental re-checks | Released as 0.13.0: a re-check after an edit checks only the statements it touched; the 40 KB script in 2.52 ms (from 22), app code in 0.04–0.19 ms. See [Re-checks](./rechecks) |
| 13. Checking through syntax errors | Released as 0.14.0: `check()`'s `syntax: 'tolerant'`, off by default, sets aside the statement a syntax error is in, reports the error and checks the rest. See [Syntax errors](./syntax-errors). The apps turn it on in their own follow-ups |
| 14–15. Coverage, then messages | Next, in order |

Everything before 1.0 can change: [work in progress, come build with us](https://smaltworks.dev/stability).
