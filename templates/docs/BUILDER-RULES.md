# Rules for every builder: {{PROJECT_NAME}}

You build ONE package of a wave. Several builders work in the SAME working tree at the same time, each on its own
files. Nothing is committed while you work, so there is no safety net: one wrong command destroys the others' work.
The owner may watch the result live on the dev server (port {{DEV_PORT}}), which runs on this tree.

Your brief adds what is yours: the package id, your file list, the specs to read, the frozen interfaces, the absolute
path of your report and of your backup folder. The brief wins over this file where they differ.

## 1. Read first

1. `AGENTS.md` and `docs/RULES.md`. They are hard constraints.
2. Your brief: the rules for every builder of the wave first, then the spec of EACH of your items, whole.
3. Each file you are about to change, as it is NOW. Other builders are editing other files right now, and line
   numbers in the specs may have moved: find each place by its words. If the spec and the code disagree, follow the
   spec's intent with the smallest faithful change, and say so in your report.

## 2. Ownership: hard

- Write ONLY the files in your brief's list, plus the new files your items name. Nothing else.
- A change you need in a file you do not own goes in your report under "Needs from others": the file, the exact
  text, the item it serves. Do not make it yourself, even if it is one line.
- Never remove or narrow an export, a type member or a copy key that another file reads. Add; do not change. The
  interfaces in your brief's frozen table are fixed: code against them as written. The type check covers tests too,
  so a "tidy" deletion turns another builder's test red.
- E2E specs: do not write them unless your brief gives them to you. Put what a browser must prove in your report
  under "E2E for later".
- Message catalogs: small targeted edits, every locale together, never a whole-file rewrite. No key twice in one
  object: such JSON still parses, and the last key wins silently.
- Backups: before a risky edit, copy the file into the ABSOLUTE backup folder your brief gives (unique to your
  package). A relative path resolves against whatever folder you are in, and lands in the wrong place.

## 3. Never

- `git checkout`, `switch`, `stash`, `restore`, `reset`, `clean`, `add`, `commit`, `mv`, `rm`. They rewrite files
  other builders are editing. Read-only git is fine: `status`, `diff`, `log`, `show`, `grep`.
- Formatting or auto-fixing the whole tree (`prettier --write .`, `eslint --fix` on a folder).
- `build`, `dev`, `start`, E2E, the whole unit suite, `verify`, a test run on a folder. They take the dev port, or
  minutes of memory the other builders need.
- Anything on the network: `curl`, `wget`, opening the site, signing in, calling the API. A live API may hold
  production data.
- `tsc`, `eslint` or `vitest` called directly. Use the queued wrappers below.
- `pkill -f` or `pgrep -f`: the pattern also matches the shell that runs it. Nor `pkill <name>`, `pkill -x` or
  `killall`: a name also matches other projects' processes. Stop a process by its PID: find it
  (`scripts/tools/free-port.sh <port>`, or `ss -lptn` / `lsof -nP -iTCP:<port> -sTCP:LISTEN`), check its working
  directory (`/proc/<pid>/cwd` on Linux, `lsof -a -d cwd -p <pid>` on macOS), then `kill <pid>`.
- A new dependency, colour, layout or motion your spec does not name.
- A comment that cites a ticket, a decision id, a report, an agent or a job. Comments say why, in the code's terms.
- Any file outside the repository, except your report.

## 4. Build first, check once

1. Build ALL your items, with the unit tests each spec lists. Keep every file valid as you go: the dev server
   compiles this tree while you work.
2. Then, once, at the end of your package. Each wrapper waits in line behind the other builders (one heavy check at
   a time on this machine), so a wait of several minutes is normal:
   - `scripts/tools/q-tsc.sh`: the whole project. An error in a file you do not own is not yours: report it.
   - `scripts/tools/q-eslint.sh <the files you changed>`
   - `scripts/tools/q-vitest.sh <the test FILES you wrote or whose subject you changed>`: files, never a folder.
   - the project checks that apply: `pnpm check:i18n`, `pnpm check:json`, `pnpm check:theme`, `pnpm check:structure`.
3. Fix what is yours and re-run only what failed. At most three rounds; then report what is still red, and why.

## 5. Your report

Create it at the START, at the absolute path your brief gives: a title and your plan in five lines. Then APPEND as
you go, so a stop loses nothing. At the end it holds:

- per item: done, partial or skipped, and why;
- the files you changed, created and deleted;
- every new or changed copy key, with its text in each locale;
- each deviation from the spec, and its reason;
- **Needs from others**: file, exact text, the item it serves;
- **E2E for later**: what a browser must prove;
- **Where the owner sees it**: page path, role or account, what the owner sees in one sentence, and what not to
  click because it would write real data. Or "nothing to see in the browser yet";
- each check of section 4 with its real numbers (errors, warnings, tests passed and failed);
- the md5 of each file you wrote (`md5sum <files>`; on macOS `md5 -r <files>`), so a later sweep can tell whether
  another agent overwrote it.

A refused tool call: wait 30 seconds, retry once, then go on without it and say so in the report.

## 6. Your structured result

Return these keys, even when a list is empty. The ownership sweep reads the first four: a path you changed but did
not list shows up as unclaimed, and someone has to find out why.

```json
{
  "id": "<package>",
  "status": "done | partial",
  "files_changed": ["src/lib/apis/invoices/actions.ts"],
  "files_created": ["src/lib/apis/invoices/actions.test.ts"],
  "files_deleted": [],
  "touched_outside_list": ["<path> - why"],
  "checks": [{ "command": "scripts/tools/q-tsc.sh", "result": "tsc exit: 0" }],
  "needs_from_others": [{ "file": "<path>", "text": "<exact text>", "why": "<the item it serves>" }],
  "deviations": ["<what and why>"],
  "report": "<absolute path of your report>"
}
```
