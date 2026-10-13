#!/usr/bin/env python3
"""Invalid JSON and duplicate keys in translation catalogs (or any JSON files).

JSON.parse keeps the LAST of two equal keys and says nothing. So an edit that
added a new line without removing the old one passes every other check, and
the app shows whichever value happens to come last.

Usage: python3 scripts/check-json-dupes.py <dir-or-file> [more ...]
  A folder is searched recursively for *.json files. A path that does not
  exist yet is skipped with a note. Exit 0 when clean, 1 on any problem,
  2 on wrong arguments. Standard library only.
"""
import json
import os
import sys

USAGE = "Usage: python3 scripts/check-json-dupes.py <dir-or-file> [more ...]"


def json_files(path):
    if os.path.isfile(path):
        return [path]
    found = []
    for folder, dirs, files in os.walk(path):
        dirs[:] = sorted(d for d in dirs if d != "node_modules" and not d.startswith("."))
        found.extend(os.path.join(folder, name) for name in sorted(files) if name.endswith(".json"))
    return found


def duplicate_keys(text):
    """(key path, [line numbers]) for every key that repeats inside one object.

    Runs on text that already parsed, so it can trust the JSON grammar.
    """
    found, stack, line, i = [], [], 1, 0
    while i < len(text):
        char = text[i]
        if char == "\n":
            line += 1
        elif char == '"':
            end = i + 1
            while text[end] != '"':
                end += 2 if text[end] == "\\" else 1
            top = stack[-1] if stack else None
            if top is not None and top["object"] and top["expect_key"]:
                key = json.loads(text[i:end + 1])
                top["keys"].setdefault(key, []).append(line)
                top["expect_key"], top["last"] = False, key
            i = end
        elif char in "{[":
            parent = stack[-1] if stack else None
            if parent is None:
                path = ""
            elif parent["object"]:
                path = f'{parent["path"]}.{parent["last"]}' if parent["path"] else parent["last"]
            else:
                path = f'{parent["path"]}[]'
            stack.append({"object": char == "{", "expect_key": True, "keys": {}, "path": path, "last": ""})
        elif char in "}]":
            done = stack.pop()
            for key, lines in done["keys"].items():
                if len(lines) > 1:
                    found.append((f'{done["path"]}.{key}' if done["path"] else key, lines))
        elif char == "," and stack and stack[-1]["object"]:
            stack[-1]["expect_key"] = True
        i += 1
    return found


def _not_json(name):
    # Python reads NaN and Infinity; JSON.parse (the app, check-i18n) throws on them.
    raise ValueError(f"{name} is not JSON (JSON.parse rejects it)")


def problems(path):
    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        json.loads(text, parse_constant=_not_json)
    except (ValueError, UnicodeDecodeError) as error:
        return [f"invalid JSON: {error}"]
    return [
        f'duplicate key "{key}" (lines {", ".join(str(n) for n in lines)})'
        for key, lines in duplicate_keys(text)
    ]


def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(USAGE)
        return 0 if len(argv) == 2 else 2
    files, bad = [], 0
    for target in argv[1:]:
        if not os.path.exists(target):
            print(f"  note: {target} does not exist yet, skipped")
            continue
        files.extend(json_files(target))
    for path in files:
        for line in problems(path):
            bad += 1
            print(f"{path}: {line}")
    print(f"{bad} problem(s) in {len(files)} file(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
