# Hidden grader: optimal makespan and a valid plan for every case, plus error handling.
import json, signal, sys, traceback
sys.path.insert(0, ".")
from scheduler import schedule

class Timeout(Exception):
    pass

def alarm(*_):
    raise Timeout()

signal.signal(signal.SIGALRM, alarm)

def check(tasks, workers, optimum):
    signal.alarm(5)
    try:
        m, plan = schedule({k: {"duration": v["duration"], "deps": list(v["deps"])} for k, v in tasks.items()}, workers)
    finally:
        signal.alarm(0)
    assert m == optimum, f"makespan {m}, optimum {optimum}"
    assert set(plan) == set(tasks), "plan must cover every task"
    fin = {}
    for n, (s, w) in plan.items():
        assert isinstance(s, int) and s >= 0 and isinstance(w, int) and 0 <= w < workers, f"bad slot for {n}"
        fin[n] = s + tasks[n]["duration"]
    for n in tasks:
        for d in tasks[n]["deps"]:
            assert plan[n][0] >= fin[d], f"{n} starts before {d} ends"
    by = {}
    for n, (s, w) in plan.items():
        by.setdefault(w, []).append((s, fin[n]))
    for iv in by.values():
        iv.sort()
        for a, b in zip(iv, iv[1:]):
            assert a[1] <= b[0], "worker overlap"
    assert m == (max(fin.values()) if fin else 0), "makespan must equal the last finish"

def raises(fn):
    try:
        fn()
    except ValueError:
        return
    raise AssertionError("expected ValueError")

checks = []
for i, c in enumerate(json.load(open("cases.json"))):
    checks.append((f"case {i}", lambda c=c: check(c["tasks"], c["workers"], c["optimum"])))
checks += [
    ("cycle", lambda: raises(lambda: schedule({"a": {"duration": 1, "deps": ["b"]}, "b": {"duration": 1, "deps": ["a"]}}, 1))),
    ("unknown dep", lambda: raises(lambda: schedule({"a": {"duration": 1, "deps": ["zz"]}}, 1))),
    ("zero workers", lambda: raises(lambda: schedule({"a": {"duration": 1, "deps": []}}, 0))),
    ("bad duration", lambda: raises(lambda: schedule({"a": {"duration": 0, "deps": []}}, 1))),
]
passed = 0
for name, fn in checks:
    try:
        fn()
        passed += 1
    except Timeout:
        print(f"FAIL {name}: over 5 s")
    except Exception as e:
        print(f"FAIL {name}: {type(e).__name__}: {e}")
print(f"AH_SCORE {passed} {len(checks)}")
sys.exit(0 if passed == len(checks) else 1)
