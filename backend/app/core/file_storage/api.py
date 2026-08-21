from pathlib import Path
from typing import Annotated
from uuid import UUID

from app.core.access_control.auth.api import get_current_user
from app.core.access_control.users.schema import User
from app.core.database import SessionDepends
from app.core.revisions.logic import record_revision
from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi import File as FastAPIFile
from fastapi import UploadFile
from fastapi.responses import Response

from .logic import delete_bytes, read_bytes, save_bytes
from .schema import FileDB, FileMetadata

router = APIRouter(prefix="/files", tags=["files"])

CurrentUser = Annotated[User, Depends(get_current_user)]


# --- POST ----------------------------------------------------------------
@router.post("", response_model=FileMetadata, status_code=201)
async def upload_file(
    session: SessionDepends,
    user: CurrentUser,
    owner_object_type: str = Form(...),
    owner_object_uuid: UUID = Form(...),
    upload: UploadFile = FastAPIFile(...),
):
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Uploaded file has no filename.")

    data = await upload.read()

    # name identifier must be <50 chars & unique
    if len(upload.filename) < 35:
        filename_identifier = upload.filename
    else:
        filename_identifier = f"{upload.filename[:35]}..."
    for i in range(1, 99999999):
        result = session.query(FileDB).filter_by(name=filename_identifier).first()
        if result is None: break
        else:
            filename_identifier = filename_identifier.strip(f'-{i-1}') + f'-{i}'

    file_row = FileDB(
        name=filename_identifier,
        owner_object_type=owner_object_type,
        owner_object_uuid=owner_object_uuid,
        filename=upload.filename,
        extension=Path(upload.filename).suffix.lower().lstrip("."),
        size=len(data),
        mimetype=upload.content_type,
    )
    session.add(file_row)
    session.commit()
    session.refresh(file_row)

    save_bytes(file_row.uuid, data)
    record_revision(
        session,
        entity_type="file",
        entity_uuid=file_row.uuid,
        action="created",
        snapshot=FileMetadata.model_validate(file_row).model_dump(mode="json"),
        actor_uuid=user.uuid,
    )
    session.commit()
    return file_row


# --- GET -------------------------------------------------------------------
@router.get("", response_model=list[FileMetadata])
def list_files(
    session: SessionDepends,
    user: CurrentUser,
    owner_object_type: str | None = None,
    owner_object_uuid: UUID | None = None,
):
    query = session.query(FileDB)
    if owner_object_type is not None:
        query = query.filter_by(owner_object_type=owner_object_type)
    if owner_object_uuid is not None:
        query = query.filter_by(owner_object_uuid=owner_object_uuid)
    return query.all()


@router.get("/{file_id}")
def download_file(file_id: UUID, session: SessionDepends, user: CurrentUser):
    file_row = session.get(FileDB, file_id)
    if file_row is None:
        raise HTTPException(status_code=404, detail="No file found with the given id.")
    data = read_bytes(file_row.uuid)
    return Response(
        content=data,
        media_type=file_row.mimetype or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{file_row.filename}"'},
    )


# --- DELETE ------------------------------------------------------------------
@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: UUID, session: SessionDepends, user: CurrentUser):
    file_row = session.get(FileDB, file_id)
    if file_row is None:
        raise HTTPException(status_code=404, detail="No file found with the given id.")
    snapshot = FileMetadata.model_validate(file_row).model_dump(mode="json")
    session.delete(file_row)
    session.commit()
    delete_bytes(file_row.uuid)
    record_revision(
        session,
        entity_type="file",
        entity_uuid=file_id,
        action="deleted",
        snapshot=snapshot,
        actor_uuid=user.uuid,
    )
    session.commit()
