"""Export the contract without starting a server."""

import json

from app.main import create_app


def main() -> None:
    print(json.dumps(create_app().openapi()))


if __name__ == "__main__":
    main()
