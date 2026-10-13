---
name: design-direction
description: Holds the settled visual direction of this project and the owner's corrections that produced it - identity, register, surfaces, shell anatomy, motion limits and traps. It exists so settled corrections are never re-litigated. Use when starting any design work, using a design tool for a screen, or changing globals.css, a colour, a token, the top bar or the sidebar.
---

# Design direction: settled

**Status: not filled yet.** Until the owner fills this file, nothing below is settled: the "Example:" lines are
samples, not this project's direction, so never apply one. Follow the tokens and components already in the code,
and ask the owner before you set anything new that fixes the look (a colour, the shell, the register). Delete this
status line when the file is filled.

Once filled, everything below is settled by the owner. Do not reopen it, and do not re-derive it from the full
design spec. A new idea that contradicts a line here goes to the owner as a question, never straight into code.

When the owner corrects the direction, add the correction here the same day, in their words, with what it
replaced. A correction that arrives after the code is built costs a rebuild. Written here, it is made only once.

> How to fill this file: under each heading, replace the prompt (the quoted line) with your project's answer.
> Keep the example line's shape: short, concrete, with exact values. Delete the prompts and examples when done.

## Fixed, never changes

> The identity no redesign may touch: the primary colour (exact value), the logo, the brand feel.

Example: the primary `#2563eb`, the logo and the brand feel are fixed. Every redesign keeps them.

## Latitude you have

> What you may tune without asking, and the one thing inside it you may not move.

Example: the spacing inside cards, the radius scale, the chart colours. Not the 4 px grid the spacing sits on.

## The register

> The feel the owner wants, in their own words, and the feel that was tried and rejected.

Example: quiet and dense, like a spreadsheet: thin borders, no shadows. A rounded, playful look was tried and
rejected. Keep the role-token plumbing: it is how dark mode stays consistent.

## Surfaces

> The planes, their tokens and values, their roles, and where the accent may and may not appear.

Example: `--page` `#fafafa` sits behind everything; `--panel` `#ffffff` holds cards and tables, with a 1 px
`--line` border. The accent marks links and the one primary button of a screen, nothing else.

## Shell anatomy, settled

> The top bar, the sidebar, the navigation control, sizes. Note each first instinct the owner corrected.

Example: one top navigation bar and no sidebar. The bar hides on scroll down and returns on scroll up (a fixed bar
was proposed and rejected: it covered table headers). Tables show 25 rows; the pager hides when one page is enough.

## Traps that already bit

> Each trap in two lines: what broke, and the rule that prevents it.

Example: a gradient utility named `bg-*` deleted the colour beside it (`tailwind-merge` treats every `bg-*` as one
group). Name gradients `wash-*`.

## Restraint

> The limits on the register: what the product must never look like, and the test for any effect.

Example: motion is felt, not watched: 150 to 300 ms, it explains a change of state, it runs once. Nothing bounces
for attention, nothing autoplays, no confetti. The test for any effect: does it belong in a serious work tool?

## Where the detail lives

> The full spec and the token file, with the section to open for each kind of change. Never read the whole spec.

Example: `docs/UI-SPEC.md`: §1 Shell, §2 Tokens, §3 Components, §4 Page skeleton, §5 Motion. Tokens:
`src/app/globals.css`.

## Using a design tool

> When a design canvas or tool is worth it, and what to read before you open it.

Example: read this file first, then open the design tool, so the mockups start from the settled direction. Worth it
for screens the backend cannot serve yet: the day the endpoints land, the screen is a build, not a debate.
