from duration import parse_duration


def test_seconds():
    assert parse_duration("45s") == 45
