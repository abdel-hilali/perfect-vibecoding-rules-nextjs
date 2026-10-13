#!/usr/bin/env node
// PreToolUse hook for the Bash and PowerShell tools (wired in hooks/hooks.json).
//
// 1. Denies `pkill -f` and any kill fed by `pgrep -f`. Both match the pattern against the
//    full command line of every process. The shell that runs the command carries the same
//    pattern in its own command line, so the kill ends the tool call itself (exit 144).
// 2. The owner watches the dev port live. A command that can take it (a build, a start, an
//    E2E run, PORT=<dev port>, free-port.sh on it) shows the owner a one-line warning as it
//    starts (systemMessage) and gives Claude a note. A command that only names the port
//    (curl, ss, lsof, fuser) gets the note only. Claude reads a PreToolUse note with the
//    command's result, too late to warn first, so the warning goes to the owner.
//
// Input: the PreToolUse JSON on stdin. Output: one JSON object on stdout, or nothing.
// Always exits 0, and prints nothing on any error, so a bug here never blocks a command.
// It guards against accidents, not against a command written to slip past it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_DEPTH = 24; // how deep we follow $( ), backticks and `bash -c` strings
const MAX_INPUT = 2 * 1024 * 1024;

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;
const OPS3 = [';;&', '<<<', '<<-', '&>>'];
const OPS2 = ['&&', '||', '|&', ';;', ';&', '<<', '>>', '&>', '>&', '<&', '>|', '<>'];
const OPS1 = [';', '&', '|', '<', '>'];
const REDIRS = new Set(['<<<', '<<-', '&>>', '<<', '>>', '&>', '>&', '<&', '>|', '<>', '<', '>']);
const META = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '<', '>', '(', ')']);
const SEPARATORS = new Set([';', '\n', '&', '&&', '||', ';;', ';&', ';;&']);
const STRAY = new Set(['then', 'do', 'else', 'elif', 'fi', 'done', 'esac', '}', 'in']);

// ---------------------------------------------------------------- lexer

// Reads tokens from s[start..]. With untilParen, stops after the `)` that closes a `$(`.
function tokenize(s, start, depth, untilParen) {
  const toks = [];
  const waiting = []; // heredocs whose body starts after the next newline
  let expectDelim = null;
  let parens = 0;
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '\\' && s[i + 1] === '\n') { i += 2; continue; }
    if (c === '\n') {
      toks.push({ t: 'op', v: '\n' });
      i++;
      if (waiting.length) i = readHeredocBodies(s, i, waiting.splice(0), depth);
      continue;
    }
    if (c === '#') { // a comment runs to the end of the line
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === ')') {
      if (untilParen && parens === 0) return { toks, end: i + 1 };
      if (parens > 0) parens--;
      toks.push({ t: 'op', v: ')' });
      i++;
      continue;
    }
    if (c === '(') { parens++; toks.push({ t: 'op', v: '(' }); i++; continue; }
    if ((c === '<' || c === '>') && s[i + 1] === '(') { // process substitution <( ) or >( )
      const r = readSub(s, i + 2, depth);
      toks.push({ t: 'word', text: s.slice(i, r.end), subs: r.sub ? [r.sub] : [], quoted: false });
      i = r.end;
      continue;
    }
    const op = OPS3.find((o) => s.startsWith(o, i)) || OPS2.find((o) => s.startsWith(o, i))
      || OPS1.find((o) => s.startsWith(o, i));
    if (op) {
      i += op.length;
      if (REDIRS.has(op)) {
        const tok = { t: 'redir', v: op };
        if (op === '<<' || op === '<<-') {
          tok.heredoc = { delim: null, quoted: false, strip: op === '<<-', body: '', subs: [] };
          expectDelim = tok.heredoc;
        }
        toks.push(tok);
      } else {
        toks.push({ t: 'op', v: op });
      }
      continue;
    }
    const w = readWord(s, i, depth);
    i = w.end;
    // Digits right before < or > name a file descriptor (2>&1), not an argument.
    if (/^\d+$/.test(w.text) && !w.quoted && (s[i] === '<' || s[i] === '>')) continue;
    if (expectDelim) {
      expectDelim.delim = w.text;
      expectDelim.quoted = w.quoted;
      waiting.push(expectDelim);
      expectDelim = null;
    }
    toks.push(w);
  }
  return { toks, end: i };
}

function readWord(s, i, depth) {
  let text = '';
  const subs = [];
  let quoted = false;
  while (i < s.length) {
    const c = s[i];
    if (META.has(c)) {
      if (c === '(' && /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=$/.test(text)) { // name=( array )
        const e = skipBalanced(s, i + 1, '(', ')');
        subs.push(...scanExpansions(s.slice(i + 1, e - 1), depth)); // P=($(pgrep -f x)) runs pgrep
        text += s.slice(i, e);
        i = e;
        continue;
      }
      break;
    }
    if (c === '\\') {
      if (s[i + 1] === '\n') { i += 2; continue; }
      if (i + 1 < s.length) text += s[i + 1];
      i += 2;
      quoted = true;
      continue;
    }
    if (c === "'") {
      const e = s.indexOf("'", i + 1);
      const end = e < 0 ? s.length : e;
      text += s.slice(i + 1, end);
      i = end + 1;
      quoted = true;
      continue;
    }
    if (c === '"') {
      const r = readDouble(s, i + 1, depth);
      text += r.text;
      subs.push(...r.subs);
      i = r.end;
      quoted = true;
      continue;
    }
    if (c === '`') {
      const r = readBacktick(s, i + 1, depth);
      text += r.raw;
      if (r.sub) subs.push(r.sub);
      i = r.end;
      continue;
    }
    if (c === '$') {
      if (s[i + 1] === "'") {
        const r = readAnsi(s, i + 2);
        text += r.text;
        i = r.end;
        quoted = true;
        continue;
      }
      const r = readDollar(s, i, depth);
      if (r) {
        text += r.raw;
        if (r.sub) subs.push(r.sub);
        i = r.end;
        continue;
      }
    }
    text += c;
    i++;
  }
  return { t: 'word', text, subs, quoted, end: Math.min(i, s.length) };
}

function readDouble(s, i, depth) {
  let text = '';
  const subs = [];
  while (i < s.length && s[i] !== '"') {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      if (n === '\n') { i += 2; continue; }
      if (n === '"' || n === '\\' || n === '$' || n === '`') { text += n; i += 2; continue; }
      text += c;
      i++;
      continue;
    }
    if (c === '`') {
      const r = readBacktick(s, i + 1, depth);
      text += r.raw;
      if (r.sub) subs.push(r.sub);
      i = r.end;
      continue;
    }
    if (c === '$') {
      const r = readDollar(s, i, depth);
      if (r) {
        text += r.raw;
        if (r.sub) subs.push(r.sub);
        i = r.end;
        continue;
      }
    }
    text += c;
    i++;
  }
  return { text, subs, end: Math.min(i + 1, s.length) };
}

function readAnsi(s, i) { // $'...'
  let text = '';
  while (i < s.length && s[i] !== "'") {
    if (s[i] === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      text += n === 'n' ? '\n' : n === 't' ? '\t' : n;
      i += 2;
      continue;
    }
    text += s[i];
    i++;
  }
  return { text, end: Math.min(i + 1, s.length) };
}

// $( ) runs a command; $(( )) and ${ } do not. Returns null for a plain $name.
function readDollar(s, i, depth) {
  if (s.startsWith('$((', i)) {
    const e = skipBalanced(s, i + 3, '(', ')', 2);
    return { raw: s.slice(i, e), sub: null, end: e };
  }
  if (s[i + 1] === '(') {
    const r = readSub(s, i + 2, depth);
    return { raw: s.slice(i, r.end), sub: r.sub, end: r.end };
  }
  if (s[i + 1] === '{') {
    const e = skipBalanced(s, i + 2, '{', '}');
    return { raw: s.slice(i, e), sub: null, end: e };
  }
  return null;
}

function readSub(s, i, depth) {
  if (depth >= MAX_DEPTH) return { sub: null, end: skipBalanced(s, i, '(', ')') };
  const r = tokenize(s, i, depth + 1, true);
  return { sub: parse(r.toks, depth + 1), end: r.end };
}

function readBacktick(s, i, depth) {
  let body = '';
  while (i < s.length && s[i] !== '`') {
    if (s[i] === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      body += n === '`' || n === '\\' || n === '$' ? n : s[i] + n;
      i += 2;
      continue;
    }
    body += s[i];
    i++;
  }
  const sub = depth >= MAX_DEPTH ? null : parseString(body, depth + 1);
  return { raw: '`' + body + '`', sub, end: Math.min(i + 1, s.length) };
}

function skipBalanced(s, i, open, close, level = 1) {
  while (i < s.length && level > 0) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === open) level++;
    else if (c === close) level--;
    i++;
  }
  return Math.min(i, s.length);
}

function readHeredocBodies(s, i, docs, depth) {
  for (const doc of docs) {
    const lines = [];
    while (i < s.length) {
      let nl = s.indexOf('\n', i);
      if (nl < 0) nl = s.length;
      const raw = s.slice(i, nl);
      i = Math.min(nl + 1, s.length);
      const line = doc.strip ? raw.replace(/^\t+/, '') : raw;
      if (line === doc.delim) break;
      lines.push(line);
    }
    doc.body = lines.join('\n');
    // An unquoted delimiter means the shell expands $( ) and backticks in the body.
    if (!doc.quoted) doc.subs = scanExpansions(doc.body, depth);
  }
  return i;
}

function scanExpansions(t, depth) {
  const subs = [];
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      const r = readBacktick(t, i + 1, depth);
      if (r.sub) subs.push(r.sub);
      i = r.end;
      continue;
    }
    if (c === '$') {
      const r = readDollar(t, i, depth);
      if (r) {
        if (r.sub) subs.push(r.sub);
        i = r.end;
        continue;
      }
    }
    i++;
  }
  return subs;
}

// ---------------------------------------------------------------- parser
// A script is a list of pipelines; a pipeline is a list of elements. An element is a
// simple command or a group: ( ), { }, if, while, until, for, case, or a function body.

function parseString(str, depth) {
  if (depth > MAX_DEPTH) return [];
  return parse(tokenize(str, 0, depth, false).toks, depth);
}

function parse(toks, depth) {
  return parseList({ toks, i: 0, depth }, new Set());
}

const isOp = (tk, v) => Boolean(tk) && tk.t === 'op' && tk.v === v;
const isBare = (tk) => Boolean(tk) && tk.t === 'word' && !tk.quoted && tk.subs.length === 0;
const isWord = (tk, v) => isBare(tk) && tk.text === v;
const isTerm = (tk, terms) => Boolean(tk) && (tk.t === 'op' ? terms.has(tk.v) : isBare(tk) && terms.has(tk.text));

function parseList(p, terms) {
  const list = [];
  while (p.i < p.toks.length) {
    const tk = p.toks[p.i];
    if (isTerm(tk, terms)) return list;
    if (tk.t === 'op' && (SEPARATORS.has(tk.v) || tk.v === ')')) { p.i++; continue; }
    const before = p.i;
    const pipe = parsePipeline(p, terms);
    if (pipe.length) list.push(pipe);
    if (p.i === before) p.i++;
  }
  return list;
}

function parsePipeline(p, terms) {
  const els = [];
  for (;;) {
    while (els.length && isOp(p.toks[p.i], '\n')) p.i++; // a newline may follow a pipe
    const el = parseElement(p, terms);
    if (el) els.push(el);
    if (isOp(p.toks[p.i], '|') || isOp(p.toks[p.i], '|&')) { p.i++; continue; }
    return els;
  }
}

function parseElement(p, terms) {
  for (;;) {
    const tk = p.toks[p.i];
    if (!tk || isTerm(tk, terms)) return null;
    if (tk.t === 'op') {
      if (tk.v !== '(') return null;
      p.i++;
      const body = parseList(p, new Set([')']));
      if (isOp(p.toks[p.i], ')')) p.i++;
      return finishGroup(p, { kind: 'group', body });
    }
    if (isBare(tk)) {
      const w = tk.text;
      if (w === '!') { p.i++; continue; }
      if (w === 'time') { p.i++; if (isWord(p.toks[p.i], '-p')) p.i++; continue; }
      if (STRAY.has(w)) { p.i++; continue; }
      if (w === '{') {
        p.i++;
        const body = parseList(p, new Set(['}']));
        if (isWord(p.toks[p.i], '}')) p.i++;
        return finishGroup(p, { kind: 'group', body });
      }
      if (w === 'if') return parseIf(p);
      if (w === 'while' || w === 'until') {
        p.i++;
        const cond = parseList(p, new Set(['do']));
        if (isWord(p.toks[p.i], 'do')) p.i++;
        const body = parseList(p, new Set(['done']));
        if (isWord(p.toks[p.i], 'done')) p.i++;
        return finishGroup(p, { kind: 'group', body: [...cond, ...body] });
      }
      if (w === 'for' || w === 'select') return parseFor(p);
      if (w === 'case') return parseCase(p);
      if (w === 'function') {
        p.i++;
        if (p.toks[p.i] && p.toks[p.i].t === 'word') p.i++;
        if (isOp(p.toks[p.i], '(') && isOp(p.toks[p.i + 1], ')')) p.i += 2;
        while (isOp(p.toks[p.i], '\n')) p.i++;
        continue;
      }
    }
    return parseSimple(p, terms);
  }
}

function parseIf(p) {
  p.i++;
  const body = [];
  for (;;) {
    body.push(...parseList(p, new Set(['then'])));
    if (isWord(p.toks[p.i], 'then')) p.i++;
    body.push(...parseList(p, new Set(['elif', 'else', 'fi'])));
    if (isWord(p.toks[p.i], 'elif')) { p.i++; continue; }
    if (isWord(p.toks[p.i], 'else')) { p.i++; body.push(...parseList(p, new Set(['fi']))); }
    if (isWord(p.toks[p.i], 'fi')) p.i++;
    return finishGroup(p, { kind: 'group', body });
  }
}

function parseFor(p) {
  p.i++;
  const header = { name: null, words: [] };
  if (isBare(p.toks[p.i])) { header.name = p.toks[p.i].text; p.i++; }
  while (p.i < p.toks.length && !isWord(p.toks[p.i], 'do')) {
    const tk = p.toks[p.i];
    if (tk.t === 'word' && !isWord(tk, 'in')) header.words.push(tk);
    p.i++;
  }
  if (isWord(p.toks[p.i], 'do')) p.i++;
  const body = parseList(p, new Set(['done']));
  if (isWord(p.toks[p.i], 'done')) p.i++;
  return finishGroup(p, { kind: 'group', header, body });
}

function parseCase(p) {
  p.i++;
  const subjectSubs = [];
  if (p.toks[p.i] && p.toks[p.i].t === 'word') { subjectSubs.push(...p.toks[p.i].subs); p.i++; }
  while (isOp(p.toks[p.i], '\n')) p.i++;
  if (isWord(p.toks[p.i], 'in')) p.i++;
  const body = [];
  const caseTerms = new Set([';;', ';&', ';;&', 'esac']);
  while (p.i < p.toks.length) {
    while (isOp(p.toks[p.i], '\n') || isOp(p.toks[p.i], ';')) p.i++;
    if (!p.toks[p.i] || isWord(p.toks[p.i], 'esac')) break;
    while (p.i < p.toks.length && !isOp(p.toks[p.i], ')')) p.i++; // the pattern
    p.i++;
    body.push(...parseList(p, caseTerms));
    const tk = p.toks[p.i];
    if (tk && tk.t === 'op' && caseTerms.has(tk.v)) p.i++;
  }
  if (isWord(p.toks[p.i], 'esac')) p.i++;
  const g = finishGroup(p, { kind: 'group', body });
  g.inputSubs.push(...subjectSubs);
  return g;
}

// Redirections after a group, such as `done < <(pgrep -f x)`, feed the group. inputTexts keeps
// what a here-string or an unquoted heredoc expands, such as `done <<< "$pids"`.
function finishGroup(p, g) {
  g.inputSubs = [];
  g.inputTexts = [];
  while (p.toks[p.i] && p.toks[p.i].t === 'redir') {
    const r = p.toks[p.i];
    p.i++;
    const target = p.toks[p.i];
    if (target && target.t === 'word') { p.i++; g.inputSubs.push(...target.subs); g.inputTexts.push(target.text); }
    if (r.heredoc) {
      g.inputSubs.push(...r.heredoc.subs);
      if (!r.heredoc.quoted) g.inputTexts.push(r.heredoc.body);
    }
  }
  return g;
}

function parseSimple(p, terms) {
  const cmd = { kind: 'simple', words: [], assigns: [], redirSubs: [], heredocs: [], herestrings: [], depth: p.depth };
  while (p.i < p.toks.length) {
    const tk = p.toks[p.i];
    if (tk.t === 'op') {
      if (tk.v === '(' && cmd.words.length === 1 && isOp(p.toks[p.i + 1], ')')) { // name() { body; }
        p.i += 2;
        while (isOp(p.toks[p.i], '\n')) p.i++;
        const body = parseElement(p, terms);
        return { kind: 'group', body: body ? [[body]] : [], inputSubs: [] };
      }
      break;
    }
    if (tk.t === 'redir') {
      p.i++;
      const target = p.toks[p.i];
      if (target && target.t === 'word') {
        p.i++;
        cmd.redirSubs.push(...target.subs);
        if (tk.v === '<<<') cmd.herestrings.push(target.text);
      }
      if (tk.heredoc) {
        cmd.heredocs.push(tk.heredoc);
        cmd.redirSubs.push(...tk.heredoc.subs);
      }
      continue;
    }
    if (cmd.words.length === 0 && ASSIGN.test(tk.text)) cmd.assigns.push(tk);
    else cmd.words.push(tk);
    p.i++;
  }
  return cmd;
}

// ---------------------------------------------------------------- command words

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash', 'mksh']);
const PMS = new Set(['pnpm', 'npm', 'yarn', 'bun']);
const PM_ARGS = {
  pnpm: new Set(['-C', '--dir', '--filter', '-F']),
  npm: new Set(['-w', '--workspace', '--prefix', '-C']),
  yarn: new Set(['--cwd']),
  bun: new Set(['--cwd', '--filter', '-F']),
};
const DECLARERS = new Set(['export', 'local', 'declare', 'readonly', 'typeset']);
const SUDO_ARGS = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T', '--user', '--group',
  '--close-from', '--chdir', '--host', '--prompt', '--role', '--type', '--other-user', '--command-timeout']);
const XARGS_ARGS = new Set(['-I', '-d', '-E', '-a', '-L', '-n', '-P', '-s', '--arg-file', '--delimiter',
  '--max-args', '--max-procs', '--max-chars', '--process-slot-var']);
const base = (t) => t.slice(t.lastIndexOf('/') + 1);

// Skips options from texts[k]; options in withArg take the next word. Stops after `--`.
function skipOptions(texts, k, withArg) {
  while (k < texts.length && texts[k].startsWith('-') && texts[k] !== '-') {
    if (texts[k] === '--') return k + 1;
    k += withArg.has(texts[k]) ? 2 : 1;
  }
  return k;
}

// Finds the real command behind wrappers (sudo, env, nohup, timeout, xargs, npx ...) and
// the scripts it runs from a string (bash -c, eval, watch, a heredoc fed to a shell).
function resolve(cmd) {
  if (cmd._r) return cmd._r;
  const words = cmd.words;
  const texts = words.map((w) => w.text);
  const r = { name: null, args: [], argv: [], nested: [], assigns: [], stdinShell: false };
  cmd._r = r;
  const run = (str) => { if (cmd.depth < MAX_DEPTH) r.nested.push(parseString(str, cmd.depth + 1)); };
  const n = words.length;
  let k = 0;
  while (k < n) {
    const name = base(texts[k]);
    if (name === 'sudo' || name === 'doas') { k = skipOptions(texts, k + 1, SUDO_ARGS); continue; }
    if (name === 'env') {
      k++;
      while (k < n) {
        const a = texts[k];
        if (a === '--') { k++; break; }
        if (a === '-S' || a === '--split-string') { run(texts.slice(k + 1).join(' ')); return r; }
        if (a === '-u' || a === '-C' || a === '--unset' || a === '--chdir') { k += 2; continue; }
        if (a.startsWith('-')) { k++; continue; }
        if (ASSIGN.test(a)) { r.assigns.push(words[k]); k++; continue; }
        break;
      }
      continue;
    }
    if (name === 'nohup' || name === 'builtin') { k++; continue; }
    if (name === 'command') {
      k++;
      while (k < n && /^-[pvV]+$/.test(texts[k])) {
        if (/[vV]/.test(texts[k])) return r; // `command -v x` only looks x up
        k++;
      }
      continue;
    }
    if (name === 'exec') { k = skipOptions(texts, k + 1, new Set(['-a'])); continue; }
    if (name === 'time') { k = skipOptions(texts, k + 1, new Set(['-f', '-o', '--format', '--output'])); continue; }
    if (name === 'nice') { k = skipOptions(texts, k + 1, new Set(['-n', '--adjustment'])); continue; }
    if (name === 'timeout') { k = skipOptions(texts, k + 1, new Set(['-s', '-k', '--signal', '--kill-after'])) + 1; continue; }
    if (name === 'setsid') { k = skipOptions(texts, k + 1, new Set()); continue; }
    if (name === 'stdbuf') { k = skipOptions(texts, k + 1, new Set(['-i', '-o', '-e'])); continue; }
    if (name === 'ionice') { k = skipOptions(texts, k + 1, new Set(['-c', '-n'])); continue; }
    if (name === 'xargs') {
      k = skipOptions(texts, k + 1, XARGS_ARGS);
      if (k >= n) { r.name = 'echo'; return r; } // xargs with no command runs echo
      continue;
    }
    if (name === 'npx' || name === 'bunx' || name === 'pnpx') {
      k = skipOptions(texts, k + 1, new Set(['-p', '--package']));
      continue;
    }
    if (PMS.has(name)) { // pnpm exec, npm exec, yarn exec, pnpm dlx, yarn dlx, bun x
      const j = skipOptions(texts, k + 1, PM_ARGS[name]);
      if (texts[j] === 'exec' || texts[j] === 'dlx' || texts[j] === 'x') {
        k = j + 1;
        if (texts[k] === '--') k++;
        continue;
      }
    }
    if (name === 'watch') { // watch hands its arguments to `sh -c`
      const j = skipOptions(texts, k + 1, new Set(['-n', '--interval', '-q', '--equexit']));
      r.name = 'watch';
      run(texts.slice(j).join(' '));
      return r;
    }
    break;
  }
  if (k >= n) return r;
  r.name = base(texts[k]);
  r.args = words.slice(k + 1);
  r.argv = texts.slice(k + 1);
  if (SHELLS.has(r.name)) shellScripts(cmd, r, run);
  else if (r.name === 'eval') run(r.argv.join(' '));
  return r;
}

function shellScripts(cmd, r, run) {
  const a = r.argv;
  let j = 0;
  let hasC = false;
  while (j < a.length) {
    const t = a[j];
    if (t === '--' || t === '-') { j++; break; }
    if (/^[-+][A-Za-z]+$/.test(t)) {
      if (t[0] === '-' && t.includes('c')) hasC = true;
      j += /[oO]/.test(t) ? 2 : 1; // -o pipefail, -O extglob
      continue;
    }
    if (t.startsWith('--')) { j += t === '--rcfile' || t === '--init-file' ? 2 : 1; continue; }
    break;
  }
  if (hasC) { if (j < a.length) run(a[j]); return; }
  if (j < a.length) return; // runs a script file
  r.stdinShell = true; // reads its commands from stdin
  for (const h of cmd.heredocs) run(h.body);
  for (const s of cmd.herestrings) run(s);
}

// True when pkill or pgrep options include -f / --full (also inside a group like -fx).
const PG_ARG_SHORT = new Set(['d', 'g', 'G', 'O', 'P', 's', 't', 'u', 'U', 'F', 'r', 'q']);
const PG_ARG_LONG = new Set(['delimiter', 'pgroup', 'group', 'older', 'parent', 'session', 'terminal', 'euid',
  'uid', 'pidfile', 'runstates', 'ns', 'nslist', 'signal', 'env', 'cgroup', 'queue']);
function usesFull(argv) {
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--') return false;
    if (a.startsWith('--')) {
      const name = a.slice(2).split('=')[0];
      if (name && 'full'.startsWith(name)) return true; // getopt accepts --fu, --ful
      if (PG_ARG_LONG.has(name) && !a.includes('=')) k++;
      continue;
    }
    if (a.length < 2 || a[0] !== '-') continue;
    for (let c = 1; c < a.length; c++) {
      if (a[c] === 'f') return true;
      if (PG_ARG_SHORT.has(a[c])) { if (c === a.length - 1) k++; break; } // -F pidfile, -u user
    }
  }
  return false;
}

// ---------------------------------------------------------------- analysis

function scriptHas(script, pred) {
  return script.some((pipe) => pipe.some((el) => elementHas(el, pred)));
}

function elementHas(el, pred) {
  const inSubs = (subs) => subs.some((s) => scriptHas(s, pred));
  if (el.kind === 'group') {
    return scriptHas(el.body, pred) || inSubs(el.inputSubs)
      || (el.header ? el.header.words.some((w) => inSubs(w.subs)) : false);
  }
  if (pred(el)) return true;
  const r = resolve(el);
  return r.nested.some((s) => scriptHas(s, pred)) || inSubs(el.redirSubs)
    || el.assigns.some((w) => inSubs(w.subs)) || el.words.some((w) => inSubs(w.subs));
}

const isPgrepFull = (cmd) => { const r = resolve(cmd); return r.name === 'pgrep' && usesFull(r.argv); };
const isKill = (cmd) => {
  const r = resolve(cmd);
  if (r.name !== 'kill') return false;
  // `kill -0` only tests that a PID exists; `kill -l` lists signal names.
  return !r.argv.some((a, k) => a === '-0' || a === '-l' || a === '-L' || (a === '-s' && r.argv[k + 1] === '0'));
};
const subsHavePgrepFull = (w) => w.subs.some((s) => scriptHas(s, isPgrepFull));
const varName = (text) => (text.match(/^[A-Za-z_][A-Za-z0-9_]*/) || [''])[0];
const refsVar = (text, names) => [...names].some((v) => new RegExp(`\\$\\{?[#!]?${v}(?![A-Za-z0-9_])`).test(text));
// A word carries pgrep -f PIDs when it runs pgrep -f or reads a variable that holds them.
const carries = (w, ctx) => subsHavePgrepFull(w) || (ctx.taint.size > 0 && refsVar(w.text, ctx.taint));

function deny(ctx, kind) { if (!ctx.deny) ctx.deny = kind; }

function analyze(script, ctx) {
  for (const pipe of script) {
    for (const el of pipe) visit(el, ctx);
    let fed = false; // an earlier element of this pipeline prints pgrep -f PIDs
    for (let e = 0; e < pipe.length; e++) {
      const el = pipe[e];
      if (fed && elementHas(el, isKill)) deny(ctx, 'pgrep');
      if (e > 0 && el.kind === 'simple' && resolve(el).stdinShell) feedShell(pipe[e - 1], el, ctx);
      // `echo $pids | xargs kill` passes the PIDs on as well as `pgrep -f x | xargs kill`.
      if (elementHas(el, isPgrepFull) || (el.kind === 'simple' && el.words.some((w) => carries(w, ctx)))) fed = true;
    }
  }
}

// `echo 'cmd' | bash` runs the echoed text as a script.
function feedShell(prev, shell, ctx) {
  if (prev.kind !== 'simple' || shell.depth >= MAX_DEPTH) return;
  const r = resolve(prev);
  let text = null;
  if (r.name === 'echo') text = r.argv.filter((a) => !/^-[neE]+$/.test(a)).join(' ');
  if (r.name === 'printf') text = r.argv.slice(1).join('\n');
  // `cat <<'EOF' | bash` (or `cat -`) runs the heredoc's text as a script.
  if (r.name === 'cat' && r.argv.every((a) => a === '-')) {
    text = [...prev.heredocs.map((h) => h.body), ...prev.herestrings].join('\n');
  }
  if (text !== null) analyze(parseString(text, shell.depth + 1), ctx);
}

function visit(el, ctx) {
  if (el.kind === 'group') {
    for (const s of el.inputSubs) analyze(s, ctx);
    if (el.header) {
      for (const w of el.header.words) for (const s of w.subs) analyze(s, ctx);
      if (varName(el.header.name || '') && el.header.words.some((w) => carries(w, ctx))) ctx.taint.add(varName(el.header.name));
    }
    analyze(el.body, ctx);
    const groupFed = el.inputSubs.some((s) => scriptHas(s, isPgrepFull))
      || (ctx.taint.size > 0 && (el.inputTexts || []).some((t) => refsVar(t, ctx.taint)));
    if (groupFed && scriptHas(el.body, isKill)) deny(ctx, 'pgrep');
    return;
  }
  for (const w of [...el.assigns, ...el.words]) for (const s of w.subs) analyze(s, ctx);
  for (const s of el.redirSubs) analyze(s, ctx);
  const r = resolve(el);
  for (const s of r.nested) analyze(s, ctx);
  const assigns = [...el.assigns, ...r.assigns, ...(DECLARERS.has(r.name) ? r.args.filter((w) => ASSIGN.test(w.text)) : [])];
  for (const a of assigns) if (subsHavePgrepFull(a)) ctx.taint.add(varName(a.text));
  if (r.name === 'pkill' && usesFull(r.argv)) deny(ctx, 'pkill');
  // Stdin fed by pgrep -f: `read P < <(pgrep -f x)`, `xargs kill <<< "$pids"`, a heredoc holding $pids.
  const fedTexts = [...el.herestrings, ...el.heredocs.filter((h) => !h.quoted).map((h) => h.body)];
  const fedIn = el.redirSubs.some((s) => scriptHas(s, isPgrepFull))
    || (ctx.taint.size > 0 && fedTexts.some((t) => refsVar(t, ctx.taint)));
  if (fedIn && (r.name === 'read' || r.name === 'mapfile' || r.name === 'readarray')) {
    for (const t of r.argv) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) ctx.taint.add(t);
  }
  if (fedIn && isKill(el)) deny(ctx, 'pgrep');
  if (isKill(el)) {
    if (r.args.some(subsHavePgrepFull)) deny(ctx, 'pgrep');
    else if (ctx.taint.size && r.argv.some((t) => refsVar(t, ctx.taint))) deny(ctx, 'pgrep');
  }
  if (ctx.port) checkPort(r, assigns, ctx);
}

// ---------------------------------------------------------------- dev port

const TEXT_ONLY = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'git', 'cat', 'sed', 'awk',
  'head', 'tail', 'less', 'wc']);
const STARTS = new Set(['dev', 'build', 'start']);
const firstPositional = (a) => a.find((t) => !t.startsWith('-'));

// take(): the command can take the dev site down. hit(): it only names the port.
function checkPort(r, assigns, ctx) {
  const P = ctx.port;
  const hit = () => { ctx.portHit = true; };
  const take = () => { ctx.portHit = true; ctx.portTake = true; };
  if (assigns.some((a) => a.text === `PORT=${P}`)) return take();
  if (!r.name) return undefined;
  const a = r.argv;
  if (r.name === 'next' && STARTS.has(firstPositional(a))) return take();
  if (r.name === 'playwright' && firstPositional(a) === 'test') return take();
  if (PMS.has(r.name)) {
    let j = skipOptions(a, 0, PM_ARGS[r.name]);
    if (a[j] === 'run' || a[j] === 'run-script') j = skipOptions(a, j + 1, PM_ARGS[r.name]);
    const script = a[j] || '';
    const rest = a.slice(j + 1);
    if (STARTS.has(script) || script.startsWith('test:e2e')) return take();
    if (script === 'next' && STARTS.has(firstPositional(rest))) return take();
    if (script === 'playwright' && firstPositional(rest) === 'test') return take();
  }
  if (TEXT_ONLY.has(r.name)) return undefined;
  const colon = new RegExp(`:${P}(?![0-9])`);
  for (let k = 0; k < a.length; k++) {
    const t = a[k];
    if ((t === '-p' || t === '--port') && a[k + 1] === P) return hit();
    if (t === `-p${P}` || t === `--port=${P}` || colon.test(t)) return hit();
    if ((r.name === 'free-port.sh' || r.name === 'fuser') && (t === P || t === `${P}/tcp`)) {
      return r.name === 'free-port.sh' ? take() : hit();
    }
  }
  return undefined;
}

// DEV_PORT from the environment, else from the project's scripts/tools/tools.env.
function devPort(env, payload) {
  if (/^\d{2,5}$/.test(env.DEV_PORT || '')) return env.DEV_PORT;
  const dir = env.CLAUDE_PROJECT_DIR || (typeof payload.cwd === 'string' ? payload.cwd : '');
  if (!dir) return null;
  let text;
  try { text = readFileSync(join(dir, 'scripts', 'tools', 'tools.env'), 'utf8'); } catch { return null; }
  const m = text.match(/^[ \t]*:[ \t]*["']?\$\{DEV_PORT:?=(\d{2,5})\}/m)
    || text.match(/^[ \t]*(?:export[ \t]+)?DEV_PORT=["']?(\d{2,5})\b/m);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- output

const KILL_BY_PID = [
  'Kill by PID instead, never by name:',
  '1. Find the PID. The process on a port: `scripts/tools/free-port.sh <port>` if the project has it, or',
  '   `ss -lptn "sport = :<port>"` (macOS: `lsof -nP -iTCP:<port> -sTCP:LISTEN`). A process by its arguments:',
  '   list `ps -eo pid=,args=` inside a script file and match there, skipping your own PID and its parent.',
  '2. Check its working directory: `readlink /proc/<pid>/cwd` (macOS: `lsof -a -d cwd -p <pid>`).',
  '   Leave it alone when it belongs to another project or to the editor.',
  '3. Then `kill <pid>`.',
  "Never `pkill <name>`, `pkill -x <name>` or `killall <name>`: a name also matches other projects' servers",
  "and the editor's own helpers.",
].join('\n');

const REASONS = {
  pkill: [
    'Blocked: `pkill -f` matches the pattern against the full command line of every process.',
    'The shell that runs this command has the same pattern in its own command line, so pkill kills this very call',
    '(exit 144) and the commands after it never run.',
    KILL_BY_PID,
  ].join('\n'),
  pgrep: [
    'Blocked: these PIDs come from `pgrep -f`, which matches the full command line of every process.',
    'The shell that runs this command has the same pattern in its own command line, so the list includes that shell,',
    'and the kill ends this very call (exit 144) before the commands after it run.',
    KILL_BY_PID,
  ].join('\n'),
};

// Claude reads this note with the command's result, so it states what happened and what comes next.
const portNote = (P, take) => (take ? [
  `Dev port note: this command can take port ${P}: it builds, starts or E2E-tests the app, runs a server on it, or frees it.`,
  `Port ${P} (DEV_PORT) serves the dev site the owner watches live, so the site is down while it runs.`,
  'The owner saw a one-line warning when it started. Tell the owner when the site is back, and restart the',
  'dev keeper afterwards. The project rule is to announce such downtime in the message before the command.',
] : [
  `Dev port note: this command names port ${P} (DEV_PORT), which serves the dev site the owner watches live.`,
  'Reading or probing the port (curl, ss, lsof) does not take it down. A build, a start, an E2E run or freeing',
  'the port does: announce that downtime in the message before such a command, and restart the dev keeper after.',
]).join('\n');

// Shown to the owner as the command starts.
const portWarning = (P) => `Dev port ${P}: this command can take the dev site down while it runs.`;

function decide(payload, env) {
  if (!payload || typeof payload !== 'object') return null;
  // On Windows, Claude Code may run shell commands through its PowerShell tool instead of Bash.
  if (payload.tool_name && payload.tool_name !== 'Bash' && payload.tool_name !== 'PowerShell') return null;
  const command = payload.tool_input && payload.tool_input.command;
  if (typeof command !== 'string' || !command.trim() || command.length > MAX_INPUT) return null;
  const port = devPort(env, payload);
  if (!port && !/pkill|pgrep/.test(command)) return null;
  const ctx = { deny: null, port, portHit: false, portTake: false, taint: new Set() };
  analyze(parseString(command, 0), ctx);
  if (ctx.deny) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASONS[ctx.deny] } };
  }
  if (!ctx.portHit) return null;
  // Never a decision for the port: a note for Claude, plus a warning for the owner when the site can go down.
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: portNote(port, ctx.portTake) } };
  if (ctx.portTake) out.systemMessage = portWarning(port);
  return out;
}

let input = '';
process.on('uncaughtException', () => { process.exitCode = 0; });
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('error', () => { process.exitCode = 0; });
process.stdin.on('end', () => {
  try {
    const out = decide(JSON.parse(input), process.env);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {
    // Print nothing: a bug in this guard must never block or break a command.
  }
  process.exitCode = 0;
});
