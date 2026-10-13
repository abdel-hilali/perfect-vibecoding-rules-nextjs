# {{PROJECT_NAME}}: the working record

{{PURPOSE}}

Opened {{TODAY}}. Updated in place, the day each stage lands. **In a new session, read §8 first, then §0 to §4
before you touch code.** §8 sits on top so it is read first; the section numbers never change, so references hold.

How to keep this file:
- The newest "State" block in §8 goes on top. Mark the one under it "superseded by the block above".
- Clock times come from `date`, never from memory or an estimate. The next session orders events by them.
- The owner's words go in verbatim, in quotes, with the time. Every decision goes in §1b or §7 with its reason.
- Write §8 before you say "this is a session boundary, open a new session". Keep it resumable at all times.

---

## 8. Handoff (read this first)

**State ({{TODAY}}): the record is open. READ THIS FIRST.**
- **State:** nothing built yet. Nothing runs. Nothing is uncommitted.
- **Open for the owner:** paste the brief into §1, word for word.
- **NEXT, in order:**
  1. Fill §1 (the brief) and §2 (the rules this work follows).
  2. Plan the stages in §3 and put each open question in §4, the recommendation first.
  3. Start stage 1 after the owner's yes and their budget.
- **Paste-ready prompt for the next session:**
  *"Continue {{PROJECT_NAME}}. Read docs/PROGRESS.md §8 first (the newest State block), then §0 to §4, then the
  newest entries of §7."*

<!-- Each new State block, on top of the older ones:
**State (YYYY-MM-DD HH:MM, from `date`): <one line>. READ THIS FIRST.**
- **State:** what is built, committed, pushed, live. What is uncommitted, and its backup path.
- **Runs or not:** "nothing runs", or each process left running on purpose, and why.
- **Open for the owner:** each question or action waiting on them, the recommendation first.
- **Known and left on purpose:** small issues you chose not to fix now, one line each.
- **NEXT, in order:** numbered steps, each with its rough cost and where its inputs are.
- **Paste-ready prompt for the next session:** *"Continue <work>. Read docs/PROGRESS.md §8 first ..."*
-->

---

## 0. State

- **Code:** branch `<branch>`, last commit `<sha>`; pushed: yes / no; live: yes / no / unknown.
- **Uncommitted:** none / `<n>` paths; backup: `runs/<topic>/backups/<name>/`.
- **Runs:** dev server on port {{DEV_PORT}}: up / down; keeper and guards: up / down; agents: none.
- **Open risks:** none yet.

## 1. The brief (verbatim)

> Paste the owner's request here, exactly as written. Do not summarize it.

## 1b. The owner's decisions

| # | Time (from `date`) | Question | The owner's answer (verbatim) | What it changes |
|---|---|---|---|---|
| 1 | | | | |

## 2. Rules

- The project rules: `AGENTS.md` and `docs/RULES.md`. Builders also follow `docs/BUILDER-RULES.md`.
- Rules for this work only: add them here, one line each, with the reason.

## 3. Stages

### 3.0 Order

1. `<stage>`: what it delivers, which packages, rough cost, status (planned / running / landed / gated / pushed).

### 3.1 Ownership

Each package (one agent's assignment) owns a list of files that no other package touches. Anything else goes in
its report under "Needs from others". The full rules: `docs/BUILDER-RULES.md`.

### 3.2 Interfaces frozen

Types, exports and copy keys that later packages read. Add to them; never remove or narrow one.

## 4. Decisions for the owner

Each open question: the question in one line, the readings, **the recommendation (marked)**, what each option costs.

### 4b. Calls taken without asking

Small calls the agent took on its own. The owner may veto any of them; each is cheap to change.

## 5. Screens (as needed)

The screens or features this work touches, one row each: route, status, what is left.

## 6. Asks, risks, traps (as needed)

What was asked of the backend team and its answer, the open risks, and the traps that already cost time.

## 7. Log

Newest entry last. One heading per session or per stage, with the clock time from `date`. In each: the owner's
words verbatim with the time, every decision and its reason, what was launched and what it cost, what landed, and
the checks with real numbers.

### {{TODAY}}: the record opened

- The record created from the template.
