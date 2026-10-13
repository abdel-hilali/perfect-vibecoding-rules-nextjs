# Wave plan: the form

Write the plan in `runs/<topic>/PLAN.md` (or in the record, `docs/PROGRESS.md`, section 3) before any builder
starts. Builders get their own package plus sections 1 and 2. Replace the example lines; keep the headings.

## 1. Ownership rules (tell every builder)

Number them, so a brief or a review can cite "O3".

- **O1** A package writes ONLY its listed files. Anything else goes in its report under "Needs from others"; the
  finish pass applies it.
- **O2** The interfaces in section 2 are frozen after wave 1: later waves may ADD exports, never change or remove one.
- **O3** Copy (message catalogs) is written by ONE package per wave. The others name the keys they need under
  "Needs from others".
- **O4** Files several waves need are handed on in this order, one owner at a time:
  `src/lib/apis/invoices/actions.ts` = A1 (wave 1), then B2 (wave 2, the `send` action only).
- **O5** Import by file path, never through a barrel `index.ts`: a barrel would be one file every package edits.
- **O6** Only the orchestrator writes the record. Packages write their own report.

## 2. Interfaces frozen at the end of wave 1

One row per shared export. "Shape" says exactly what another package may rely on.

| export | file | shape · rule |
|---|---|---|
| `Invoice`, `InvoiceStatus` | `src/lib/apis/invoices/types.ts` (A1) | `status` is `"draft" \| "sent" \| "paid"`; `paidAt` is `null` until paid |
| `listInvoicesServer({ projectId })` | `src/lib/apis/invoices/server-apis.ts` (A1) | one server fetch; never sends an empty filter |
| `INVOICES_PAGE_SIZES` | `src/lib/apis/invoices/form-schemas.ts` (A1) | `[10, 20, 50]`; an unknown value falls back to 10 |
| `GET /api/invoices/download-pdf/[id]` | `src/app/api/invoices/download-pdf/[id]/route.ts` (A2) | one line over `proxy()`; streams the file |
| `<InvoiceTable rows copy locale />` | type in `src/components/invoices/invoice-table-props.ts` (A1) | component built by B1 in wave 2; the type exists first so callers compile |

## 3. Packages

Per package:

**A1: invoice contract layer (wave 1).** Reads: the spec sections it needs.
- **Owns (new):** `src/lib/apis/invoices/{types,form-schemas,server-apis}.ts` (+ their tests).
- **Owns (changed):** `src/lib/server/fetch-server.ts` (+ test).
- **Builds:** section 2 exactly.
- **Tests:** the parsers (empty and unknown values), the request paths, the error codes.
- **Report:** `<project>/runs/<topic>/reports/A1.md` · **Backups:** `<project>/runs/<topic>/backups/A1/` (absolute).

## 4. Launch checklist

- [ ] Every file appears in at most one "Owns" list of this wave.
- [ ] Every frozen interface exists and its check is green.
- [ ] Each brief names its report path and backup folder, both absolute and unique.
- [ ] Each brief points to `docs/BUILDER-RULES.md` and asks for the structured result.
- [ ] The launch script is saved in `runs/<topic>/`.
- [ ] The owner knows the cost estimate and where to look when the first package lands.

## 5. Sweeps after the wave

**md5 sweep.** Run it the moment the wave lands, before the finish pass writes anything. Each builder ends its
report with the md5 of each file it wrote. Collect those lines into `runs/<topic>/md5-owners.txt`, one line per
file as the builder's command printed it (`<md5> <path>`, paths from the app root). Then, from the app root:

```bash
md5sum -c --quiet runs/<topic>/md5-owners.txt             # Linux: prints only the files that changed
md5 -r $(awk '{print $2}' runs/<topic>/md5-owners.txt) | diff runs/<topic>/md5-owners.txt -   # macOS
```

A file listed there was rewritten after its owner finished. Read its diff, keep the right version, and find out who
wrote it (the ownership sweep usually tells).

**Ownership sweep**, after the finish pass. Every changed path must be claimed by exactly one agent. Pass the
journals of every run since the last commit (earlier waves, the finish pass):

```bash
python3 -I scripts/tools/sweep-owners.py <journal.jsonl> [<journal.jsonl> ...]
# --repo <app folder> when APP_DIR (the environment, else tools.env) is not the app
# exit 1 = an unclaimed path or a same-run conflict
```

No journal (builders started by hand, or a tool that keeps none)? Save each builder's structured result as one
JSON line in `runs/<topic>/results.jsonl`, then sweep that file:

```json
{"type":"result","agentId":"A1","result":{"files_changed":["src/lib/server/fetch-server.ts"],"files_created":[],"files_deleted":[],"touched_outside_list":[]}}
```
