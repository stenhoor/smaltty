# Status

**In development.** smaltty is 0.10.0 (milestone 9; 0.9.0 shipped in smaltworks 0.9.0) and not on npm yet. The plan and its order are in [Milestones](../MILESTONES).

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
| 10. Entry points and size | Done in smaltty (unreleased, 0.11.0): `smaltty/strip`, `smaltty/bind` and `smaltty/check`; the stripping path is 24.5 KB gzipped. The apps load the checker only in its worker once they take smaltkit's change |
| 11–15. Speed in the page, then coverage | Next, in order |

Everything before 1.0 can change: [work in progress, come build with us](https://smaltworks.dev/stability).
