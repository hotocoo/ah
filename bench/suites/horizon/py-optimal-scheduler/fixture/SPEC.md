# Optimal task scheduler

Implement `schedule(tasks, workers)` in `scheduler.py`.

- `tasks`: `dict[str, dict]`, each value `{"duration": int >= 1, "deps": list[str]}`.
- `workers`: number of identical workers.

A task may start only after every task in its `deps` has finished. A worker runs one task at a time, without interruption. Workers are numbered `0 .. workers-1`.

Return `(makespan, plan)`:

- `plan`: `dict[str, tuple[int, int]]` mapping every task to `(start_time, worker)`; start times are integers >= 0.
- `makespan`: the time the last task finishes. It must be the **minimum possible** for the input, not just a good one.

Raise `ValueError` when `workers < 1`, a dependency names an unknown task, a duration is not a positive integer, or the dependencies contain a cycle.

An empty `tasks` returns `(0, {})`.

Inputs in the tests have up to 10 tasks and up to 3 workers. Each call must finish in under 5 seconds.
