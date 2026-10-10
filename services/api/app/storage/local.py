from pathlib import Path
from typing import BinaryIO


class LocalStorage:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def put_file(self, key: str, path: Path) -> None:
        raise NotImplementedError

    def open(self, key: str) -> BinaryIO:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError

    def exists(self, key: str) -> bool:
        raise NotImplementedError
