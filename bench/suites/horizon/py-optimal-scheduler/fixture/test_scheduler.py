from scheduler import schedule


def test_chain():
    tasks = {"a": {"duration": 2, "deps": []}, "b": {"duration": 3, "deps": ["a"]}}
    makespan, plan = schedule(tasks, 2)
    assert makespan == 5
    assert plan["b"][0] >= plan["a"][0] + 2
