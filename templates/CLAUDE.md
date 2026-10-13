@AGENTS.md

# Claude Code notes for {{PROJECT_NAME}}

The project rules are in `AGENTS.md`, imported above. These notes add only what is specific to Claude Code.

- **Skills.** With the plugin `perfect-vibecoding-rules-nextjs` enabled, the playbooks listed in `AGENTS.md` are
  skills: Claude loads them by itself when a task matches. Run one by name with
  `/perfect-vibecoding-rules-nextjs:<skill>`: `code-rules`, `recipes`, `screen`, `gate`, `dev`, `tools`,
  `multi-agent`, `session-rules`, `working-rules`, `new-project`. The project skill
  `.claude/skills/design-direction/SKILL.md` holds the settled design direction: fill it, and keep it current.
- **Hooks.** The Bash hook denies `pkill -f` and any kill fed by `pgrep -f`. For a command that can take the dev
  port (`DEV_PORT` in `scripts/tools/tools.env`): a build, `next dev` or `next start`, an E2E run, `free-port.sh`,
  `PORT=<N>`, it shows the owner a one-line warning as the command starts, and gives Claude a note with the
  command's result. That note comes too late for that job: announce such a job first, then restart the dev keeper
  and tell the owner when the site is back. A command that only names the port (curl, ss, lsof) gets the note
  alone. The save-chat hook copies each session's transcript into `claude-chats/` when Claude finishes a reply,
  before a compaction and at session end. That folder ignores itself in git: never commit or share it.
- **Plugin options.** `save_chats` (default on) and `chats_dir` (default `claude-chats`, relative to the project).
  Change them in `/config`, or in `/plugin` > Installed > Configure options.
- **Keep the transcripts.** Claude Code deletes its own transcripts after `cleanupPeriodDays` (30 by default). Set
  `{ "cleanupPeriodDays": 3650 }` in `~/.claude/settings.json`.
- **Long runs.** Start long commands and the 20-minute waiter (`scripts/tools/wait-milestone.sh`) with the Bash
  tool's background option, so their end wakes you. Copy each workflow script into `runs/<topic>/` right after you
  launch it: a new session cannot resume an old workflow run, only relaunch it from the script and the reports.
- **Bash calls** sent together share one working directory: use absolute paths.
