"""Route census entries; permission rows arrive with authenticated routes."""

PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/v1/health"),
        ("POST", "/api/v1/auth/login"),
        ("POST", "/api/v1/auth/refresh"),
        ("POST", "/api/v1/auth/logout"),
    }
)

# Permission row 2. Request builders are added by the P2-5 security frame.
PERMISSION_MATRIX: dict[tuple[str, str], dict[str, int]] = {
    ("GET", "/api/v1/me"): {"member": 200, "leader": 200},
    ("PATCH", "/api/v1/me"): {"member": 200, "leader": 200},
    ("POST", "/api/v1/me/password"): {"member": 204, "leader": 204},
    ("POST", "/probe/pet"): {"member": 200, "leader": 200},
}

# Test-only probe until production sync mutations arrive.
IDEMPOTENT_ROUTES: dict[tuple[str, str], str] = {("POST", "/probe/pet"): "pets"}
