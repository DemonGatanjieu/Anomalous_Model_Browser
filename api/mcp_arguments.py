"""Normalize an unambiguous argument name before approval, execution and task recording."""

JSON_TYPES = {"string": (str,), "integer": (int,), "number": (int, float), "boolean": (bool,), "array": (list,), "object": (dict,)}


def prepare_arguments(spec, arguments):
    """Return (arguments, (wrong, right) or None), without changing the caller's dictionary."""
    unknown = set(arguments) - set(spec["properties"])
    missing = [key for key in spec.get("required", []) if key not in arguments]
    if len(unknown) != 1 or len(missing) != 1:
        return arguments, None
    wrong, right = next(iter(unknown)), missing[0]
    kinds = JSON_TYPES.get(spec["properties"][right].get("type"))
    value = arguments[wrong]
    if not kinds or not isinstance(value, kinds) or (isinstance(value, bool) and bool not in kinds):
        return arguments, None
    corrected = {key: value for key, value in arguments.items() if key != wrong}
    corrected[right] = value
    return corrected, (wrong, right)


def renaming_note(name, renamed):
    return f"Took {renamed[0]} as {renamed[1]}: {name} calls it {renamed[1]}."
