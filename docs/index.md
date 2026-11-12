---
layout: home

hero:
  name: 'sm<span class="alt">alt</span><span class="suffix family">ty</span>'
  text: 'Small. Alternative.<br>Code.'
  tagline: TypeScript for the smalt apps. smaltty is smalt's own implementation of TypeScript, a top-level smalt product. It parses, strips, binds and type-checks TypeScript in the browser, with no dependencies.
  image:
    light: /grain-mark.svg
    dark: /grain-mark-on-dark.svg
    alt: smaltty
  actions:
    - theme: brand
      text: Getting started
      link: /guide/getting-started
features:
  - title: Types removed, nothing moved
    details: Types become spaces, so every line and column of the JavaScript is the one written, and an error points where it was typed.
    link: /guide/stripping
    linkText: Stripping types
  - title: TypeScript's own rules
    details: The tree is TypeScript's, node for node. Where TypeScript and other tools differ, smaltty does what TypeScript does.
    link: /guide/parsing
    linkText: Parsing
  - title: Every name, bound
    details: Which declaration each name means, by TypeScript's scoping rules, checked against TypeScript's checker on over 500,000 names.
    link: /guide/binding
    linkText: Binding names
  - title: Fast and small
    details: 35 KB gzipped and no outside code, in plain ES2022 modules that load in a page without a bundler. Every change is benchmarked.
    link: /BENCHMARKS
    linkText: Benchmarks
---

<p style="text-align:center;margin-top:2.5rem;color:var(--vp-c-text-2)">One of the smaltworks kits: the apps use it through smaltkit. In development: see <a href="./guide/status">Status</a>.</p>
