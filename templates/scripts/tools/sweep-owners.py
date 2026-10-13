#!/usr/bin/env python3
"""Ownership sweep after a wave of parallel builders. Read-only: it runs `git status` and reads the journals.

Every path git sees changed in the repository must be claimed by exactly one agent, in the structured result each
agent returned (files_changed, files_created, files_deleted, touched_outside_list), as the workflow journals
recorded it. A journal is JSON lines: {"type":"started","agentId":..,"label":..} and
{"type":"result","agentId":..,"result":{...}}.

It prints:
  UNCLAIMED                    changed paths no agent names: a write outside a list, or a stray file
  CLAIMED BY MORE THAN ONE     paths two agents name; in the same run that is a conflict, across runs a hand-over
  TOUCHED OUTSIDE THEIR LIST   paths an agent says it touched outside its list: judge each one
  claimed but not changed      reverted, never written, or a wrong path in a result

A claim may name a folder ("tests/area/" or "tests/area/**"): it covers every path under it.
Exit 0 when nothing is unclaimed and no run has a conflict, 1 when something is, 2 on wrong arguments.

usage: python3 -I sweep-owners.py [--repo DIR] <journal.jsonl> [<journal.jsonl> ...]
  DIR defaults to APP_DIR, as the bash tools take it: the environment, else tools.env beside this script, else the
  app two folders above this script. Only paths under DIR are swept.
"""
import json
import os
import posixpath
import re
import subprocess
import sys

USAGE = "usage: python3 -I sweep-owners.py [--repo DIR] <journal.jsonl> [<journal.jsonl> ...]"
CLAIM_KEYS = ("files_changed", "files_created", "files_deleted")
# A note after the path, as agents often write it: "src/a.ts - why", "src/a.ts (why)", "src/a.ts: why".
NOTE_SEPARATORS = (" — ", " – ", " - ", " (", ": ", "\t")


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(2)


def default_repo():
    """APP_DIR from the environment, else from tools.env beside this script, else the app two folders up."""
    if os.environ.get("APP_DIR"):
        return os.environ["APP_DIR"]
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        with open(os.path.join(here, "tools.env"), encoding="utf-8") as fh:
            m = re.search(r'^\s*:\s*"\$\{APP_DIR:=([^}]*)\}"', fh.read(), re.M)
        if m and m.group(1).strip():
            return os.path.expanduser(os.path.expandvars(m.group(1).strip()))
    except OSError:
        pass
    return os.path.dirname(os.path.dirname(here))


def parse_args(argv):
    repo, journals, i = None, [], 0
    while i < len(argv):
        a = argv[i]
        if a == "--repo":
            if i + 1 >= len(argv):
                fail(USAGE)
            repo, i = argv[i + 1], i + 2
            continue
        if a.startswith("-"):
            fail(USAGE)
        journals.append(a)
        i += 1
    if not journals:
        fail(USAGE)
    return repo or default_repo(), journals


def git_changed(repo):
    """Changed paths under `repo`, relative to it, mapped to their two-letter status."""
    # GIT_OPTIONAL_LOCKS=0: git status must not refresh the index while builders may be working in the tree.
    env = dict(os.environ, GIT_OPTIONAL_LOCKS="0")

    def git(*args):
        try:
            return subprocess.run(["git", "-C", repo, *args], capture_output=True, env=env)
        except OSError:
            fail("sweep-owners: git is not installed")

    prefix = git("rev-parse", "--show-prefix")
    if prefix.returncode != 0:
        fail(f"sweep-owners: {repo} is not inside a git work tree")
    prefix = prefix.stdout.decode().strip()
    out = git("status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".")
    if out.returncode != 0:
        fail(f"sweep-owners: git status failed in {repo}")
    items = out.stdout.decode("utf-8", "surrogateescape").split("\0")
    changed, i = {}, 0
    while i < len(items):
        record = items[i]
        i += 1
        if len(record) < 4:
            continue
        status, path = record[:2], record[3:]
        changed[path] = status
        if "R" in status or "C" in status:  # -z puts the original path in the next field
            if "R" in status and i < len(items) and items[i]:
                changed[items[i]] = "R-"  # renamed away: its old path must be claimed too
            i += 1
    return {p[len(prefix):]: s for p, s in changed.items() if p.startswith(prefix)}


def normalize(entry, repo_real):
    """A claimed path relative to the repo; None when it lies outside the repo or says nothing."""
    if isinstance(entry, dict):
        entry = entry.get("path") or entry.get("file") or ""
    if not isinstance(entry, str):
        return None
    # Compare in git's own form, forward slashes, whatever the system or the agent wrote.
    p = entry.strip().strip("`").replace("\\", "/")
    for sep in NOTE_SEPARATORS:
        p = p.split(sep, 1)[0]
    p = re.sub(r":\d+(-\d+)?$", "", p.strip().strip("`"))  # a line reference: src/a.ts:12
    if not p:
        return None
    if os.path.isabs(p):
        real = os.path.realpath(p)
        if real != repo_real and not real.startswith(repo_real + os.sep):
            return None
        p = os.path.relpath(real, repo_real).replace(os.sep, "/")
    folder = p.endswith("/") or p.endswith("/**")
    p = posixpath.normpath(p.rstrip("*").rstrip("/"))
    if p == "." or p.startswith(".."):
        return None
    return p + "/" if folder else p


def read_claims(journals, repo_real):
    """Returns ({path: {(run, agent)}}, {path: {agent}} outside lists, results read, bad lines, outside count)."""
    claims, outside, results, bad, beyond = {}, {}, 0, 0, 0
    for run, journal in enumerate(journals, 1):
        labels = {}
        try:
            with open(journal, encoding="utf-8", errors="replace") as fh:
                lines = fh.read().splitlines()
        except OSError as e:
            fail(f"sweep-owners: cannot read {journal}: {e.strerror}")
        for n, line in enumerate(lines, 1):
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except ValueError:
                bad += 1
                continue
            if not isinstance(e, dict):
                continue
            if e.get("type") == "started":
                labels[e.get("agentId")] = e.get("label") or e.get("agentId")
            if e.get("type") != "result":
                continue
            r = e.get("result")
            if isinstance(r, str):
                try:
                    r = json.loads(r)
                except ValueError:
                    continue
            if not isinstance(r, dict):
                continue
            results += 1
            who = labels.get(e.get("agentId")) or r.get("id") or e.get("agentId") or f"line {n}"
            if len(journals) > 1:
                who = f"{who} (journal {run})"
            for key in CLAIM_KEYS + ("touched_outside_list",):
                for entry in r.get(key) or []:
                    p = normalize(entry, repo_real)
                    if p is None:
                        beyond += 1
                        continue
                    claims.setdefault(p, set()).add((run, who))
                    if key == "touched_outside_list":
                        outside.setdefault(p, set()).add(who)
    return claims, outside, results, bad, beyond


def owners_of(path, claims):
    found = set(claims.get(path, ()))
    for claim, who in claims.items():
        if claim.endswith("/") and path.startswith(claim):
            found |= who
    return found


def main():
    repo, journals = parse_args(sys.argv[1:])
    if not os.path.isdir(repo):
        fail(f"sweep-owners: {repo} is not a folder")
    repo_real = os.path.realpath(repo)
    changed = git_changed(repo)
    claims, outside, results, bad, beyond = read_claims(journals, repo_real)

    print(f"repo: {repo_real} · changed paths: {len(changed)}")
    print(f"journals: {len(journals)} · agent results: {results} · unreadable lines: {bad} · claims outside the repo: {beyond}")
    if results == 0:
        print("  no agent result found: is this the right journal, and did the agents return a structured result?")

    unclaimed = sorted(p for p in changed if not owners_of(p, claims))
    print(f"UNCLAIMED (changed, no agent names it): {len(unclaimed)}")
    for p in unclaimed:
        print(f"   {changed[p]} {p}")

    conflict = False
    multi = []
    for p in sorted(changed):
        owners = owners_of(p, claims)
        if len({who for _, who in owners}) > 1:
            runs = [run for run, _ in owners]
            same_run = len(runs) != len(set(runs))
            conflict = conflict or same_run
            multi.append((p, sorted(who for _, who in owners), same_run))
    print(f"CLAIMED BY MORE THAN ONE AGENT: {len(multi)}")
    for p, who, same_run in multi:
        print(f"   {p} <- {', '.join(who)}" + ("   [same run: a conflict]" if same_run else ""))

    print(f"TOUCHED OUTSIDE THEIR LIST: {len(outside)}")
    for p in sorted(outside):
        print(f"   {p} <- {', '.join(sorted(outside[p]))}")

    gone = []
    for claim, who in sorted(claims.items()):
        hit = any(p.startswith(claim) for p in changed) if claim.endswith("/") else claim in changed
        if not hit:
            gone.append((claim, sorted(w for _, w in who)))
    print(f"claimed but not changed in git (reverted, never written, or a wrong path): {len(gone)}")
    for claim, who in gone:
        print(f"   {claim} <- {', '.join(who)}")

    return 1 if unclaimed or conflict else 0


if __name__ == "__main__":
    sys.exit(main())
