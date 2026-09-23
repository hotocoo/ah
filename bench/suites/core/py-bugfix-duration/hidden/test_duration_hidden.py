import pytest
from duration import parse_duration

@pytest.mark.parametrize("s,n", [("1h30m", 5400), ("2h", 7200), ("1h2m3s", 3723), ("90m", 5400), ("0s", 0)])
def test_values(s, n):
    assert parse_duration(s) == n

def test_invalid():
    with pytest.raises(ValueError):
        parse_duration("abc")
