"""Explicit settings limits must not depend on the Python JSON decoder's stack."""
import json
import pytest
import settings_store


def parse(raw):
    parser = getattr(settings_store, 'parse_settings_json', None)
    assert callable(parser), 'Settings need an explicit bounded JSON parser'
    return parser(raw)


def test_normal_settings_and_escaped_brackets_keep_exact_values():
    value = {'room_name': 'Room [north] "back\\slash"', 'notes': '[' * 500, 'furniture': []}
    assert parse(json.dumps(value).encode()) == value


@pytest.mark.parametrize('depth,accepted', [(127, True), (128, True), (129, False), (20000, False)])
def test_container_depth_boundary(depth, accepted):
    raw = b'{"unknown":' + b'[' * (depth - 1) + b'0' + b']' * (depth - 1) + b'}'
    if accepted:
        assert isinstance(parse(raw), dict)
    else:
        with pytest.raises(ValueError, match='nesting'):
            parse(raw)


@pytest.mark.parametrize('raw', [b'[]', b'null', b'{"sound":NaN}', b'{"budget_usd":Infinity}', b'{"x":-Infinity}'])
def test_invalid_json_objects_are_rejected(raw):
    with pytest.raises(ValueError):
        parse(raw)
