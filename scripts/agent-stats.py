#!/usr/bin/env python3
"""Per-trial stats for external harnesses, read from their own session records.

  agent-stats.py hermes <HERMES_HOME> <sandbox dir>
  agent-stats.py dsh <sandbox dir>

Prints one JSON line {turns, toolCalls, toolErrors, inputTokens, outputTokens} (fields the harness
does not record are omitted). "turns" means model requests, as in ah's own reports.
Used by `ah bench run --agent-stats` (see scripts/h2h.sh).
"""
import json
import os
import sqlite3
import subprocess
import sys


def hermes(home: str, cwd: str) -> dict:
    db = sqlite3.connect(f"file:{os.path.join(home, 'state.db')}?mode=ro", uri=True)
    row = db.execute(
        "SELECT id, api_call_count, tool_call_count, input_tokens + COALESCE(cache_read_tokens, 0), output_tokens FROM sessions WHERE cwd = ? ORDER BY started_at DESC LIMIT 1",
        (cwd,),
    ).fetchone()
    if not row:
        return {}
    # Hermes stores uncached and cache-read prompt tokens separately; ah counts all prompt tokens
    # (cache hits included), so the sum is the like-for-like figure.
    sid, calls, tools, tin, tout = row
    return {"turns": calls or 0, "toolCalls": tools or 0, "inputTokens": tin or 0, "outputTokens": tout or 0}


def dsh_events(cwd: str):
    root = os.path.expanduser("~/.dsh/sessions")
    # dsh names a session folder after its cwd; fall back to scanning headers if that changes.
    guess = os.path.join(root, "--" + cwd.strip("/").replace("/", "-") + "--")
    dirs = [guess] if os.path.isdir(guess) else [os.path.join(root, d) for d in os.listdir(root)]
    best = None
    for d in dirs:
        for s in os.listdir(d) if os.path.isdir(d) else []:
            f = os.path.join(d, s, "session.jsonl.zstd")
            if not os.path.exists(f):
                continue
            lines = subprocess.run(["zstd", "-dc", f], capture_output=True, text=True).stdout.splitlines()
            if not lines:
                continue
            head = json.loads(lines[0])
            if head.get("cwd") == cwd and (best is None or head.get("createdAt", 0) > best[0]):
                best = (head.get("createdAt", 0), lines)
    return [json.loads(l) for l in best[1]] if best else []


def dsh(cwd: str) -> dict:
    ev = dsh_events(cwd)
    if not ev:
        return {}
    steps = sum(e["type"] == "step/start" for e in ev)
    calls = sum(e["type"] == "tool/call" for e in ev)
    errors = 0
    for e in ev:
        if e["type"] == "tool/result":
            parts = e.get("data", {}).get("message", {}).get("content", [])
            errors += any(p.get("isError") for p in parts if isinstance(p, dict))
    return {"turns": steps, "toolCalls": calls, "toolErrors": errors}


if __name__ == "__main__":
    kind = sys.argv[1]
    out = hermes(sys.argv[2], os.path.realpath(sys.argv[3])) if kind == "hermes" else dsh(os.path.realpath(sys.argv[2]))
    print(json.dumps(out))
