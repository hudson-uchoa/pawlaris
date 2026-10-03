import ast
from pathlib import Path

import pytest


def clock_read_lines(source: str) -> list[int]:
    tree = ast.parse(source)
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for imported in node.names:
                aliases[imported.asname or imported.name] = imported.name
        elif isinstance(node, ast.ImportFrom) and node.module in {"datetime", "time"}:
            for imported in node.names:
                aliases[imported.asname or imported.name] = (
                    f"{node.module}.{imported.name}"
                )

    def qualified_name(node: ast.AST) -> str:
        if isinstance(node, ast.Name):
            return aliases.get(node.id, node.id)
        if isinstance(node, ast.Attribute):
            return f"{qualified_name(node.value)}.{node.attr}"
        return ""

    violations: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute | ast.Name):
            name = qualified_name(node)
            if name in {
                "datetime.now",
                "datetime.utcnow",
                "time.time",
            } or name.endswith((".datetime.now", ".datetime.utcnow")):
                violations.append(node.lineno)
    return violations


@pytest.mark.parametrize(
    "source",
    [
        "from datetime import datetime, UTC\ndatetime.now(UTC)",
        "import datetime as d\nd.datetime.now(d.UTC)",
        "import datetime as d\nd.datetime.utcnow()",
        "from datetime import datetime as dt, UTC\ndt.now(UTC)",
        "import time\ntime.time()",
        "import time as t\nt.time()",
        "from time import time as wall_time\nwall_time()",
    ],
)
def test_r2_clock_guard_reports_direct_reads_in_sample(source: str) -> None:
    assert clock_read_lines(source) == [2]


def test_r2_clock_guard_allows_injected_clock_and_duration_measurement() -> None:
    assert clock_read_lines("clock.now()\nclock.monotonic()\ntime.monotonic()") == []


def test_application_reads_wall_clock_only_in_clock_module() -> None:
    app_root = Path(__file__).resolve().parents[2] / "app"
    violations: list[str] = []
    for path in app_root.rglob("*.py"):
        if path.name == "clock.py":
            continue
        for line in clock_read_lines(path.read_text(encoding="utf-8")):
            violations.append(f"{path.relative_to(app_root)}:{line}")
    assert not violations, f"Direct clock reads outside clock.py: {violations}"
