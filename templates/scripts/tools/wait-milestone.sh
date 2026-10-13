#!/usr/bin/env bash
# Waits until a workflow journal records a finished agent, or until the timer runs out, then prints a short status.
# Run it in the background while builders work: each wake-up is a moment to update the owner, and the status costs
# a few lines of reading instead of a look at every report.
# A journal is JSON lines: {"type":"started","agentId":..,"label":..} when an agent starts, and another event
# ("result", an error...) when it ends. Any event other than "launched" or "started" counts as a milestone.
# usage: wait-milestone.sh <journal.jsonl> [seconds, default 1200] [report files ...]
#   WAIT_POLL_S=N checks every N seconds (default 20).
set -u
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

usage() {
  echo "usage: wait-milestone.sh <journal.jsonl> [seconds, default 1200] [report files ...]" >&2
  exit 2
}
[ $# -ge 1 ] || usage
journal=$1
shift
case "$journal" in '' | -*) usage ;; esac
limit=1200
if [ $# -gt 0 ]; then
  case "$1" in
    *[!0-9]*) ;;            # not a number: it is the first report file
    '') usage ;;
    *) limit=$1; shift ;;
  esac
fi
poll=${WAIT_POLL_S:-20}
case "$poll" in '' | *[!0-9]* | 0) poll=20 ;; esac

# Events that mean an agent ended. A missing journal counts 0: the run may not have written it yet.
finished_count() {
  if [ -f "$journal" ]; then
    grep -cvE '"type"[[:space:]]*:[[:space:]]*"(launched|started)"|^[[:space:]]*$' "$journal" 2>/dev/null
  else
    echo 0
  fi
}

start=$(finished_count)
t0=$(date +%s)
why=""
while :; do
  now=$(finished_count)
  if [ "$now" -gt "$start" ]; then
    why="MILESTONE: $((now - start)) agent event(s) since the wait began"
    break
  fi
  elapsed=$(( $(date +%s) - t0 ))
  if [ "$elapsed" -ge "$limit" ]; then
    why="TIMER: ${limit} s passed, no agent finished"
    break
  fi
  left=$((limit - elapsed))
  if [ "$left" -lt "$poll" ]; then sleep "$left"; else sleep "$poll"; fi
done

echo "$(date +%H:%M:%S) $why"

# Agents: who started, who finished, who failed (labels come from the "started" events).
if [ ! -f "$journal" ]; then
  echo "  journal: not found yet ($journal)"
elif command -v python3 >/dev/null 2>&1; then
  python3 -I - "$journal" <<'PY'
import json, sys

labels, ended = {}, []
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if not isinstance(e, dict):
        continue
    kind, agent = e.get("type"), e.get("agentId")
    if kind == "started":
        labels[agent] = e.get("label") or agent
    elif kind not in ("launched", None):
        ended.append((kind, agent, e))
done = [a for k, a, _ in ended if k == "result"]
print(f"  agents: {len(labels)} started, {len(done)} returned a result, {len(ended) - len(done)} other end event(s)")
for kind, agent, e in ended[-12:]:
    who = labels.get(agent) or agent or "?"
    note = str(e.get("error") or e.get("message") or "").replace("\n", " ")[:160]
    print(f"    {kind} | {who}" + (f" | {note}" if note else ""))
PY
else
  echo "  journal: $(finished_count) end event(s) (install python3 for the per-agent list)"
fi

# The tree: how many paths changed, so a silent builder shows up. GIT_OPTIONAL_LOCKS=0 keeps git status from
# rewriting the index while builders work.
if git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  n=$(GIT_OPTIONAL_LOCKS=0 git -C "$APP_DIR" status --porcelain --untracked-files=all | wc -l | tr -d ' ')
  echo "  app: $n changed path(s) in $APP_DIR"
else
  echo "  app: $APP_DIR is not a git work tree"
fi

for f in "$@"; do
  if [ -f "$f" ]; then
    echo "  $(basename "$f"): $(wc -l <"$f" | tr -d ' ') lines, last write $(date -r "$f" +%H:%M:%S)"
  else
    echo "  $(basename "$f"): not written yet"
  fi
done

if ! pid=$(port_pid "$DEV_PORT" 2>/dev/null); then site="unknown (no ss or lsof)"
elif [ -n "$pid" ]; then site="up (pid $pid)"; else site="DOWN"; fi
echo "  memory: $(mem_free_mb) MB free · dev port $DEV_PORT: $site"
