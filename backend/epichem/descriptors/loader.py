"""Reads descriptor YAML files from a directory into validated `Descriptor`
objects. Used by `epichem.importer.import_directory` for bulk YAML import
(ADR 0004 §3) — the registry (Postgres) is the source of truth; YAML is an
export/import interchange format, not desired state.

A bad file doesn't abort the whole load — it's collected as a `DescriptorError`
so the caller can report every problem in one pass instead of stopping at the
first typo.
"""

from dataclasses import dataclass
from pathlib import Path

import yaml
from pydantic import ValidationError

from epichem.schemas.descriptor import Descriptor


@dataclass
class DescriptorError:
    path: Path
    message: str

    def __str__(self) -> str:
        return f"{self.path}: {self.message}"


@dataclass
class LoadResult:
    descriptors: list[Descriptor]
    errors: list[DescriptorError]


def load_descriptors(directory: Path | str) -> LoadResult:
    directory = Path(directory)
    paths = sorted({*directory.rglob("*.yaml"), *directory.rglob("*.yml")})

    descriptors: list[Descriptor] = []
    errors: list[DescriptorError] = []

    for path in paths:
        try:
            raw = yaml.safe_load(path.read_text())
        except yaml.YAMLError as exc:
            errors.append(DescriptorError(path, f"invalid YAML: {exc}"))
            continue

        if raw is None:
            errors.append(DescriptorError(path, "empty file"))
            continue

        try:
            descriptor = Descriptor.model_validate(raw)
            descriptor.typed_spec()  # validate spec against its kind's schema now
        except ValidationError as exc:
            errors.append(DescriptorError(path, str(exc)))
            continue

        descriptors.append(descriptor)

    return LoadResult(descriptors=descriptors, errors=errors)
