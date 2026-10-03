"""Route census entries; permission rows arrive with authenticated routes."""

PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset({("GET", "/api/v1/health")})
