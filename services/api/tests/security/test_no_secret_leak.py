from typing import cast

import pytest
from fastapi import FastAPI

type Json = None | bool | int | float | str | list[Json] | dict[str, Json]


def response_secret_fields(document: dict[str, Json]) -> list[str]:
    raise NotImplementedError("not implemented")


def test_id1_no_secret_field_is_reachable_from_any_openapi_response(
    production_app: FastAPI,
) -> None:
    assert response_secret_fields(cast(dict[str, Json], production_app.openapi())) == []


def sample_document(field: str, schema: dict[str, Json]) -> dict[str, Json]:
    return {
        "paths": {
            "/sample": {
                "get": {
                    "responses": {
                        "500": {"content": {"application/json": {"schema": schema}}}
                    }
                }
            }
        },
        "components": {
            "schemas": {
                "Secret": {"type": "object", "properties": {field: {"type": "string"}}}
            }
        },
    }


@pytest.mark.parametrize("field", ["password_hash", "token_hash", "Secret", "PASSWORD"])
@pytest.mark.parametrize(
    "container", ["items", "allOf", "anyOf", "oneOf", "additionalProperties"]
)
def test_id1_scan_follows_nested_response_references_and_error_responses(
    field: str, container: str
) -> None:
    reference: dict[str, Json] = {"$ref": "#/components/schemas/Secret"}
    wrapped: Json = (
        [reference] if container in {"allOf", "anyOf", "oneOf"} else reference
    )
    document = sample_document(field, {container: wrapped})
    assert response_secret_fields(document) == [f"Secret.{field}"]


def test_id1_request_only_password_fields_are_not_response_leaks() -> None:
    document: dict[str, Json] = {
        "paths": {
            "/sample": {
                "post": {
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/Request"}
                            }
                        }
                    },
                    "responses": {"204": {"description": "No content"}},
                }
            }
        },
        "components": {
            "schemas": {
                "Request": {
                    "properties": {
                        name: {"type": "string"}
                        for name in ("password", "current_password", "new_password")
                    }
                }
            }
        },
    }
    assert response_secret_fields(document) == []


def test_id1_request_password_exception_does_not_allow_response_passwords() -> None:
    document = sample_document(
        "current_password", {"$ref": "#/components/schemas/Secret"}
    )
    assert response_secret_fields(document) == ["Secret.current_password"]


def test_id1_scan_handles_recursive_refs_and_inline_array_fields() -> None:
    schema: dict[str, Json] = {
        "properties": {
            "children": {"items": {"$ref": "#/components/schemas/Secret"}},
            "credentials": {"items": {"properties": {"secret": {"type": "string"}}}},
        }
    }
    document = sample_document("token_hash", schema)
    components = cast(dict[str, Json], document["components"])
    schemas = cast(dict[str, Json], components["schemas"])
    schemas["Secret"] = schema
    leaks = response_secret_fields(document)
    assert len(leaks) == 2
    assert all(field.endswith(".secret") for field in leaks)
