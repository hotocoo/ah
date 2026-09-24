import heapq
from functools import lru_cache


def _validate(tasks, workers):
    if not isinstance(workers, int) or workers < 1:
        raise ValueError("workers must be >= 1")
    for name, t in tasks.items():
        d = t.get("duration")
        if not isinstance(d, int) or isinstance(d, bool) or d < 1:
            raise ValueError(f"bad duration for {name}")
        for dep in t.get("deps", []):
            if dep not in tasks:
                raise ValueError(f"unknown dependency {dep}")
    state = {}

    def visit(n):
        if state.get(n) == 1:
            raise ValueError("cycle")
        if state.get(n) == 2:
            return
        state[n] = 1
        for d in tasks[n].get("deps", []):
            visit(d)
        state[n] = 2

    for n in tasks:
        visit(n)


def schedule(tasks, workers):
    _validate(tasks, workers)
    if not tasks:
        return 0, {}
    names = sorted(tasks)
    idx = {n: i for i, n in enumerate(names)}
    n = len(names)
    dur = [tasks[x]["duration"] for x in names]
    deps = [[idx[d] for d in tasks[x].get("deps", [])] for x in names]
    succ = [[] for _ in range(n)]
    for i, ds in enumerate(deps):
        for d in ds:
            succ[d].append(i)
    tail = [0] * n  # longest path from start of i to end, including i

    def tl(i):
        if tail[i]:
            return tail[i]
        tail[i] = dur[i] + max((tl(s) for s in succ[i]), default=0)
        return tail[i]

    for i in range(n):
        tl(i)
    total = sum(dur)
    best = [None, None]
    # Greedy upper bound: list scheduling by longest tail.
    seen = {}

    def search(done, finish, free, plan, cur):
        if done == (1 << n) - 1:
            if best[0] is None or cur < best[0]:
                best[0], best[1] = cur, dict(plan)
            return
        remaining = total - sum(dur[i] for i in range(n) if done >> i & 1)
        lb = max(cur, (remaining + sum(free)) / workers)
        ready = [i for i in range(n) if not done >> i & 1 and all(done >> d & 1 for d in deps[i])]
        for i in ready:
            est = max((finish[d] for d in deps[i]), default=0)
            lb = max(lb, max(est, min(free)) + tail[i])
        if best[0] is not None and lb >= best[0]:
            return
        key = (done, tuple(sorted(free)), tuple(finish[i] for i in range(n) if done >> i & 1 and any(not done >> s & 1 for s in succ[i])))
        if seen.get(key, 1 << 60) <= cur:
            return
        seen[key] = cur
        ready.sort(key=lambda i: -tail[i])
        for i in ready:
            est = max((finish[d] for d in deps[i]), default=0)
            tried = set()
            for w in sorted(range(workers), key=lambda w: free[w]):
                start = max(est, free[w])
                if (free[w], start) in tried:
                    continue
                tried.add((free[w], start))
                old = free[w]
                free[w] = start + dur[i]
                finish[i] = start + dur[i]
                plan[names[i]] = (start, w)
                search(done | 1 << i, finish, free, plan, max(cur, finish[i]))
                del plan[names[i]]
                free[w] = old
                finish[i] = 0

    search(0, [0] * n, [0] * workers, {}, 0)
    return best[0], best[1]
