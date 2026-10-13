// Pipes PreToolUse JSON into hooks/guard-bash.mjs, one process per case, and checks stdout,
// stderr and the exit code. Usage: node run-cases.mjs <empty temp dir>
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(HERE, '../../hooks/guard-bash.mjs');
const TMP = process.argv[2];
if (!TMP) {
  console.error('usage: node run-cases.mjs <empty temp dir>');
  process.exit(2);
}

// Two fake projects: one with a tools.env (DEV_PORT 4321), one without.
const PROJECT = join(TMP, 'project');
const EMPTY = join(TMP, 'project-empty');
mkdirSync(join(PROJECT, 'scripts', 'tools'), { recursive: true });
mkdirSync(EMPTY, { recursive: true });
copyFileSync(join(HERE, 'fixtures', 'project', 'scripts', 'tools', 'tools.env'), join(PROJECT, 'scripts', 'tools', 'tools.env'));

// A clean environment, so a DEV_PORT in the caller's shell never leaks into a case.
const BASE = { PATH: process.env.PATH, HOME: TMP };
const ENVS = {
  none: { env: BASE, cwd: TMP },
  port: { env: { ...BASE, DEV_PORT: '3000' }, cwd: TMP },
  project: { env: { ...BASE, CLAUDE_PROJECT_DIR: PROJECT }, cwd: TMP },
  'project-env': { env: { ...BASE, CLAUDE_PROJECT_DIR: PROJECT, DEV_PORT: '4100' }, cwd: TMP },
  cwd: { env: BASE, cwd: PROJECT },
  'project-empty': { env: { ...BASE, CLAUDE_PROJECT_DIR: EMPTY }, cwd: TMP },
};

const payload = (command, cwd, extra = {}) => JSON.stringify({
  session_id: 'test-session',
  transcript_path: join(TMP, 'test-session.jsonl'),
  cwd,
  permission_mode: 'default',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command, description: 'test case' },
  tool_use_id: 'toolu_test',
  ...extra,
});

function runHook(input, env) {
  const t0 = Date.now();
  const r = spawnSync('node', [HOOK], { input, env, encoding: 'utf8', timeout: 15000 });
  return { ...r, ms: Date.now() - t0 };
}

let passed = 0;
const failures = [];
let slowest = 0;

function check(name, r, expect, extra = {}) {
  const problems = [];
  slowest = Math.max(slowest, r.ms);
  if (r.error) problems.push(`spawn error: ${r.error.message}`);
  if (r.status !== 0) problems.push(`exit ${r.status}, want 0`);
  if ((r.stderr || '').trim()) problems.push(`stderr: ${r.stderr.trim().slice(0, 200)}`);
  const out = (r.stdout || '').trim();
  let json = null;
  if (out) {
    try { json = JSON.parse(out); } catch { problems.push(`stdout is not one JSON object: ${out.slice(0, 200)}`); }
  }
  const hso = json && json.hookSpecificOutput;
  if (expect === 'none' && out) problems.push(`want no output, got ${out.slice(0, 200)}`);
  if (expect === 'deny') {
    if (!hso || hso.hookEventName !== 'PreToolUse' || hso.permissionDecision !== 'deny') {
      problems.push(`want a deny, got ${out.slice(0, 200) || 'nothing'}`);
    } else {
      const reason = hso.permissionDecisionReason || '';
      if (!/PID/.test(reason) || !/exit 144/.test(reason)) problems.push('deny reason lacks the self-match or the PID way');
      if (extra.kind && !reason.includes(`${extra.kind} -f`)) problems.push(`deny reason should name ${extra.kind} -f`);
      // Kill by PID: find it, check its working directory, then kill it. A kill by name is only ever forbidden.
      for (const step of ['/proc/<pid>/cwd', 'lsof -a -d cwd -p <pid>', 'kill <pid>']) {
        if (!reason.includes(step)) problems.push(`deny reason lacks the PID step ${step}`);
      }
      for (const line of reason.split('\n')) {
        if (/pkill <name>|pkill -x|killall/.test(line) && !/\bNever\b/.test(line)) problems.push(`deny reason offers a kill by name: ${line.trim()}`);
      }
    }
    if (json && 'systemMessage' in json) problems.push('a deny must not also warn about the dev port');
  }
  if (expect === 'note' || expect === 'warn') {
    if (!hso || hso.hookEventName !== 'PreToolUse' || typeof hso.additionalContext !== 'string') {
      problems.push(`want a dev-port note, got ${out.slice(0, 200) || 'nothing'}`);
    } else {
      if ('permissionDecision' in hso) problems.push('a note must not carry a decision');
      if (extra.port && !hso.additionalContext.includes(`port ${extra.port}`)) problems.push(`note should name port ${extra.port}`);
    }
    // A command that can take the dev site down also warns the owner as it starts; one that only names the port does not.
    if (expect === 'warn') {
      const want = `Dev port ${extra.port}: this command can take the dev site down while it runs.`;
      if (!extra.port) problems.push('a "warn" case needs its port');
      else if (!json || json.systemMessage !== want) problems.push(`want the owner warning "${want}", got ${JSON.stringify(json && json.systemMessage)}`);
    }
    if (expect === 'note' && json && 'systemMessage' in json) problems.push('a command that only names the port must not warn the owner');
  }
  if (expect === 'any' && out && !json) problems.push('output is not JSON');
  if (extra.maxMs && r.ms > extra.maxMs) problems.push(`took ${r.ms} ms, limit ${extra.maxMs} ms`);
  if (problems.length) failures.push(`${name}: ${problems.join('; ')}`);
  else passed++;
}

// 1. The cases in fixtures/cases.json. A case with no env runs both without and with a dev port.
// expect: "deny", "none", "note" (a note for Claude only) or "warn" (the note plus the owner's warning).
const cases = JSON.parse(readFileSync(join(HERE, 'fixtures', 'cases.json'), 'utf8'));
for (const c of cases) {
  for (const envName of c.env ? [c.env] : ['none', 'port']) {
    const { env, cwd } = ENVS[envName];
    const r = runHook(payload(c.command, cwd), env);
    check(`${c.name} [${envName}]`, r, c.expect, { kind: c.kind, port: c.port });
  }
}

// 2. Bad or unexpected input: print nothing, exit 0.
const raw = [
  ['empty stdin', ''],
  ['not JSON', 'pkill -f worker'],
  ['a JSON array', '[]'],
  ['no tool_input', JSON.stringify({ tool_name: 'Bash' })],
  ['command is a number', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 42 } })],
  ['another tool', JSON.stringify({ tool_name: 'Read', tool_input: { command: 'pkill -f worker', file_path: '/x' } })],
  ['blank command', payload('   ', TMP)],
];
for (const [name, input] of raw) check(`input: ${name}`, runHook(input, ENVS.port.env), 'none');

// 2b. On Windows, Claude Code may run commands through its PowerShell tool: the same rules apply there.
const ps = (command) => payload(command, TMP, { tool_name: 'PowerShell' });
check('PowerShell: a build warns', runHook(ps('pnpm build'), ENVS.port.env), 'warn', { port: '3000' });
check('PowerShell: a probe only notes', runHook(ps('curl.exe -s http://localhost:3000/'), ENVS.port.env), 'note', { port: '3000' });
check('PowerShell: the full-match kill is denied', runHook(ps('pkill -f worker'), ENVS.none.env), 'deny', { kind: 'pkill' });
check('PowerShell: backtick escapes do not crash', runHook(ps('Write-Host "a`tb"; Get-Process | Where-Object { $_.Name -eq "node" }'), ENVS.port.env), 'none');

// 3. Size and nesting: never crash, stay fast.
const long = `${'echo a; '.repeat(100000)}pkill -f worker`;
check('800 KB command ending in pkill -f', runHook(payload(long, TMP), ENVS.port.env), 'deny', { maxMs: 5000 });
const nested10 = `echo ${'$('.repeat(10)}pkill -f worker${')'.repeat(10)}`;
check('10 nested $( ) still read', runHook(payload(nested10, TMP), ENVS.none.env), 'deny');
const nested300 = `echo ${'$('.repeat(300)}pkill -f worker${')'.repeat(300)}`;
check('300 nested $( ) does not crash', runHook(payload(nested300, TMP), ENVS.none.env), 'any', { maxMs: 5000 });
const parens = `${'('.repeat(20000)}pkill -f worker${')'.repeat(20000)}`;
check('20000 nested ( ) does not crash', runHook(payload(parens, TMP), ENVS.none.env), 'any', { maxMs: 5000 });
const quotes = `pkill -f ${'"a'.repeat(5000)}`;
check('5000 unbalanced quotes', runHook(payload(quotes, TMP), ENVS.none.env), 'any', { maxMs: 5000 });

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`guard-bash: ${passed} passed, ${failures.length} failed (slowest case ${slowest} ms)`);
process.exit(failures.length ? 1 : 0);
