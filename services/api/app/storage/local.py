import os
from pathlib import Path, PurePosixPath
from typing import BinaryIO


class LocalStorage:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def put_file(self, key: str, path: Path) -> None:
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(path, target)

    def open(self, key: str) -> BinaryIO:
        return self._path(key).open("rb")

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def _path(self, key: str) -> Path:
        relative = PurePosixPath(key)
        if (
            not key
            or relative.is_absolute()
            or ".." in relative.parts
            or "\\" in key
            or ":" in key
        ):
            raise ValueError(
                "Storage keys must be relative paths inside the blob directory."
            )
        directory = self.directory.resolve()
        target = (directory / relative).resolve()
        if target == directory or not target.is_relative_to(directory):
            raise ValueError("Storage keys must stay inside the blob directory.")
        return target
