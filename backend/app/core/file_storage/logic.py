import os
from pathlib import Path
from uuid import UUID

#: Directory file bytes are written to. Point a Docker volume at this path
#: (e.g. `volumes: files-data:/app/file_storage_data` on the api service +
#: `FILE_STORAGE_DIR=/app/file_storage_data`) so uploads survive a container
#: restart. Defaults to a local dev folder when unset.
FILE_STORAGE_DIR = Path(os.environ.get("FILE_STORAGE_DIR", "./file_storage_data"))


def _path_for(file_id: UUID) -> Path:
    return FILE_STORAGE_DIR / str(file_id)


def save_bytes(file_id: UUID, data: bytes) -> None:
    FILE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    _path_for(file_id).write_bytes(data)


def read_bytes(file_id: UUID) -> bytes:
    return _path_for(file_id).read_bytes()


def delete_bytes(file_id: UUID) -> None:
    _path_for(file_id).unlink(missing_ok=True)
