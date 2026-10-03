import ast
from pathlib import Path


def test_application_reads_wall_clock_only_in_clock_module() -> None:
    app_root = Path(__file__).resolve().parents[2] / "app"
    violations: list[str] = []
    for path in app_root.rglob("*.py"):
        if path.name == "clock.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr in {"now", "utcnow"}:
                if isinstance(node.value, ast.Name) and node.value.id == "datetime":
                    violations.append(f"{path.relative_to(app_root)}:{node.lineno}")
    assert not violations, f"Direct clock reads outside clock.py: {violations}"
