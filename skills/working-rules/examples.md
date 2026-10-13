# Working rules: message templates

Short templates for the messages the working rules ask for. Fill the angle brackets. Keep each
message short: the owner reads it between other work.

## Budget, before a launch

> **Recommended: A.** <one line: why>.
> - **A (recommended):** <what runs>. About <N> M tokens, <time range>. Stops cleanly at <point>.
> - **B:** <a smaller option>. About <N> M tokens. Stops cleanly at <point>.
> - **Stop here:** 0 tokens. The tree builds; left for later: <what>.
>
> What is your budget for today?

Rough costs from one real project (measure your own): a builder package 0.4 to 0.6 M tokens, a
finish pass about 0.5 M, a review round of 7 lanes with skeptics 5 to 6 M.

## "How much is left?"

> Before the next boundary (<name>): <what is left>, about <N> M tokens, <time range>.
> Cheapest clean stop: <point>. There, <what is done>, and nothing runs.
> Say "stop" or "go".

## A stage update

> **<Stage> done** (<clock time from `date`>). <One line: what changed>.
> Next: <stage>, about <time range>. Next update at <milestone>, or in 20 minutes at the latest.
> Where to look: <the table below, or "nothing to see in the browser yet">.

When an estimate slips, say it at once:

> Slipping: <stage> needs about <new range> more (I said <old range>). Why: <one line>.

## Where to look

| Page | Role or account | What you see | Do not click |
|---|---|---|---|
| `/invoices` | a finance admin | the new status column, filled for every row | "Send reminder" (sends real e-mail) |
| `/projects/<id>/members` | a project owner | the role badge beside each name | "Remove" (deletes a real member) |

Plumbing only:

> Nothing to see in the browser yet: this stage is <types / fixtures / copy keys>. The first visible
> change comes with <stage>.

A state the demo data never reaches:

> The empty state and the error state cannot show with the demo data. Screenshots from the fixture run:
> `<absolute path>/invoices-empty.png`, `<absolute path>/invoices-error.png`.

## A question

> **<Topic>?**
> 1. **<Option> (recommended).** <Why. Cost.>
> 2. <Option>. <Why not. Cost.>
> 3. <Option>. <Why not. Cost.>
>
> "Do the recommended" takes option 1.

## A conflict with the conception

> **Conflict: <topic>.** I settle it before I build.
> - The conception: <its reading, with the section>.
> - The backend contract: <its reading, with the route or the doc section>.
> - The prototype: <its reading>.
>
> **Recommended: <keep the conception and file backend ask #N | amend the conception with a numbered
> decision: ...>.** Why: <one line>.

## Outside edits

Find what moved since the last session, across the whole workspace:

```bash
find . -newermt "<YYYY-MM-DD HH:MM>" -type f \
  -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.next/*' \
  -not -path './runs/*' -not -path './claude-chats/*'
```

Report each one, with what you did and why:

> Edits since the last session that are not mine:
> - `src/lib/helpers/format-amount.ts`: kept. Correct, and its new test fails when the code is broken.
> - `messages/fr/invoices.json`: corrected. One key sat at the wrong level. Backup: `<absolute path>`.
> - `src/app/invoices/page.tsx`: undone. It broke the typecheck. Backup: `<absolute path>`.

## The dev port

> Running the build now: the site on port <DEV_PORT> is down about <N> minutes; it comes back by itself.

## Before the owner stops

> If you push now, this goes live: <list>. Not ready yet: <list>.
> To save the work without a deploy: a push carries commits only. Commit on a side branch first, then
> `git push origin HEAD:wip-<topic>`; it does not deploy when only `main` deploys.

## A read-only probe of a live API

One sign-in, GETs only, the cookie jar in a temp folder. Print status codes and key names, never
bodies. The demo account comes from the environment, never typed into the command, and reaches curl
on stdin, so it never shows in the process list.

```bash
dir="$(mktemp -d)"
printf '{"email":"%s","password":"%s"}' "$DEMO_EMAIL" "$DEMO_PASSWORD" |
  curl -s -c "$dir/jar" -o /dev/null -w 'sign-in %{http_code}\n' \
    -H 'content-type: application/json' --data @- "$API_URL/auth/login"
curl -s -b "$dir/jar" -o "$dir/body" -w 'GET /projects %{http_code}\n' "$API_URL/projects"
node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))))' "$dir/body"
rm -rf "$dir"
```
