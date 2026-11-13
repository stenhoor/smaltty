// The built-in types (builtins.ts), prepared (prepared.ts) when smaltty is built: `npm run build` writes this module
// in dist/ again with prepare()'s buffer for them, base64 (scripts/prepare-builtins.mjs), so a first check reads the
// built-in types in place of parsing them. From source (before the build, or under test:self's strip hook if it read
// src/), there is no buffer, and the checker parses builtins.ts's text, as it does if the buffer can't be read.

/** prepare()'s buffer for the built-in types, base64; undefined when smaltty runs from source. */
export const BUILTINS_PREPARED: string | undefined = undefined;
