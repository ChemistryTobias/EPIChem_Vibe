"""CLI (§8.3 subset). "The CLI must be able to do everything the UI can" —
at M1 scope that's: create/migrate the schema, list/export/import registry
rows as Descriptor YAML (per-row or bulk), list devices, list/add samples. The
registry (Postgres) is the source of truth (ADR 0004); YAML is an
export/import interchange format, not desired state — there is no
`reconcile` command anymore.
"""

import argparse
import sys
from pathlib import Path

from sqlalchemy import select

from epichem import exporter, importer, migrations
from epichem.api.schemas import SampleOut
from epichem.db import SessionLocal, engine
from epichem.models import (
    Bench,
    CapabilityClass,
    Device,
    Lab,
    Sample,
    Site,
    Station,
    Workcell,
    Zone,
)
from epichem.registry import create_entity
from epichem.schemas.sample import SAMPLE_STATES, SampleWrite

# (kind, CLI name, model_cls, natural-key attr) — one entry per registry kind,
# feeding the per-kind `export`/`import` subcommands below.
KIND_CLI = [
    ("Site", "site", Site, "code"),
    ("Lab", "lab", Lab, "code"),
    ("Zone", "zone", Zone, "code"),
    ("Workcell", "workcell", Workcell, "code"),
    ("Bench", "bench", Bench, "code"),
    ("Station", "station", Station, "code"),
    ("Device", "device", Device, "code"),
    ("CapabilityClass", "device-class", CapabilityClass, "name"),
]


def cmd_init_db(_args: argparse.Namespace) -> None:
    """Create *or* upgrade the schema — both are `alembic upgrade head`, so a
    fresh database and an existing one follow the same path.
    """
    migrations.upgrade("head")
    print(f"Schema at head on {engine.url}")


def cmd_db_upgrade(args: argparse.Namespace) -> None:
    migrations.upgrade(args.revision)
    print(f"Upgraded to {args.revision} on {engine.url}")


def cmd_db_downgrade(args: argparse.Namespace) -> None:
    migrations.downgrade(args.revision)
    print(f"Downgraded to {args.revision} on {engine.url}")


def cmd_db_current(_args: argparse.Namespace) -> None:
    current = migrations.current_revision()
    head = migrations.head_revision()
    if current is None:
        print(f"not migrated (head is {head}) on {engine.url}")
        return
    suffix = "" if current == head else f"  (head is {head} — run `epichem db upgrade`)"
    print(f"{current}{suffix} on {engine.url}")


def cmd_device_list(_args: argparse.Namespace) -> None:
    with SessionLocal() as session:
        devices = session.execute(select(Device)).scalars().all()
        if not devices:
            print("No devices registered.")
            return
        code_width = max(len(d.code) for d in devices)
        name_width = max(len(d.name) for d in devices)
        for d in devices:
            caps = ",".join(d.capabilities or [])
            columns = (
                f"{d.code:<{code_width}}",
                f"{d.name:<{name_width}}",
                f"{d.operational_mode:<12}",
                caps,
            )
            print("  ".join(columns))


# Samples aren't descriptor YAML (docs/adr/0005), so they get their own
# list/add commands instead of the export/import pair every other kind has.
# `add` exists mainly so a fresh database can be seeded with something to
# look at without going through the browser.


def cmd_sample_list(_args: argparse.Namespace) -> None:
    with SessionLocal() as session:
        samples = session.execute(select(Sample).order_by(Sample.code)).scalars().all()
        if not samples:
            print("No samples registered.")
            return
        code_width = max(len(s.code) for s in samples)
        name_width = max(len(s.name) for s in samples)
        for s in samples:
            amount = ""
            if s.amount_value is not None:
                amount = f"{s.amount_value:g} {s.amount_unit or ''}".strip()
            columns = (
                f"{s.code:<{code_width}}",
                f"{s.name:<{name_width}}",
                f"{s.state:<14}",
                f"{amount:<10}",
                s.location or "",
            )
            print("  ".join(columns))


def cmd_sample_add(args: argparse.Namespace) -> None:
    body = SampleWrite(
        code=args.code,
        name=args.name,
        state=args.state,
        substance=args.substance,
        amount_value=args.amount,
        amount_unit=args.unit,
        location=args.location,
        owner=args.owner,
        notes=args.notes,
    )
    with SessionLocal() as session:
        try:
            create_entity(session, Sample, "Sample", SampleOut, body.model_dump())
        except ValueError as e:
            print(f"error: {e}", file=sys.stderr)
            sys.exit(1)
        session.commit()
    print(f"[created  ] Sample           {args.code}")


def cmd_export(kind: str, model_cls: type, key_attr: str, args: argparse.Namespace) -> None:
    with SessionLocal() as session:
        obj = session.execute(
            select(model_cls).where(getattr(model_cls, key_attr) == args.ident)
        ).scalar_one_or_none()
        if obj is None:
            print(f"error: no {kind} with {key_attr} {args.ident!r}", file=sys.stderr)
            sys.exit(1)
        text = exporter.to_yaml(exporter.export_row(session, kind, obj))
    if args.out:
        args.out.write_text(text)
        print(f"wrote {args.out}")
    else:
        print(text, end="")


def cmd_import(_kind: str, args: argparse.Namespace) -> None:
    with SessionLocal() as session:
        item = importer.import_file(session, args.file)
        session.commit()
    _print_import_item(item)
    if item.action == "error":
        sys.exit(1)


def cmd_import_dir(args: argparse.Namespace) -> None:
    with SessionLocal() as session:
        report = importer.import_directory(session, args.descriptors_dir)
        session.commit()
    for item in report.items:
        _print_import_item(item)
    for err in report.loader_errors:
        print(f"[error    ] {err}")
    if not report.ok:
        sys.exit(1)


def cmd_export_dir(args: argparse.Namespace) -> None:
    with SessionLocal() as session:
        written = exporter.export_dir(session, args.out_dir)
    for path in written:
        print(f"wrote {path}")


def _print_import_item(item) -> None:
    detail = f"  {item.detail}" if item.detail else ""
    print(f"[{item.action:<9}] {item.kind:<15} {item.code}{detail}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="epichem")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser(
        "init-db", help="Create or upgrade the registry schema (alembic upgrade head)"
    ).set_defaults(func=cmd_init_db)

    db_parser = sub.add_parser("db", help="Schema migration commands")
    db_sub = db_parser.add_subparsers(dest="db_command", required=True)
    db_upgrade = db_sub.add_parser("upgrade", help="Upgrade to a revision (default: head)")
    db_upgrade.add_argument("revision", nargs="?", default="head")
    db_upgrade.set_defaults(func=cmd_db_upgrade)
    db_downgrade = db_sub.add_parser("downgrade", help="Downgrade to a revision")
    db_downgrade.add_argument("revision")
    db_downgrade.set_defaults(func=cmd_db_downgrade)
    db_sub.add_parser("current", help="Show the revision this database is at").set_defaults(
        func=cmd_db_current
    )

    import_dir_parser = sub.add_parser(
        "import-dir", help="Bulk-import a directory of descriptor YAML into the registry"
    )
    import_dir_parser.add_argument("--descriptors-dir", type=Path, required=True)
    import_dir_parser.set_defaults(func=cmd_import_dir)

    export_dir_parser = sub.add_parser(
        "export-dir", help="Bulk-export the current registry as descriptor YAML"
    )
    export_dir_parser.add_argument("--out-dir", type=Path, required=True)
    export_dir_parser.set_defaults(func=cmd_export_dir)

    for kind, cli_name, model_cls, key_attr in KIND_CLI:
        kind_parser = sub.add_parser(cli_name, help=f"{kind} commands")
        kind_sub = kind_parser.add_subparsers(dest=f"{cli_name}_command", required=True)

        export_parser = kind_sub.add_parser("export", help=f"Export a {kind} as descriptor YAML")
        export_parser.add_argument("ident", help=f"{key_attr} (or id) of the {kind} to export")
        export_parser.add_argument("-o", "--out", type=Path, default=None)
        export_parser.set_defaults(
            func=lambda args, kind=kind, model_cls=model_cls, key_attr=key_attr: cmd_export(
                kind, model_cls, key_attr, args
            )
        )

        import_parser = kind_sub.add_parser(
            "import", help=f"Import a {kind} descriptor YAML file (create or update)"
        )
        import_parser.add_argument("file", type=Path)
        import_parser.set_defaults(func=lambda args, kind=kind: cmd_import(kind, args))

        if cli_name == "device":
            kind_sub.add_parser("list", help="List registered devices").set_defaults(
                func=cmd_device_list
            )

    sample_parser = sub.add_parser("sample", help="Sample commands")
    sample_sub = sample_parser.add_subparsers(dest="sample_command", required=True)
    sample_sub.add_parser("list", help="List registered samples").set_defaults(func=cmd_sample_list)
    sample_add = sample_sub.add_parser("add", help="Register a sample")
    sample_add.add_argument("code", help="Short identifier, e.g. SMP-2026-0041")
    sample_add.add_argument("name", help="Short human-readable label")
    sample_add.add_argument("--state", default="registered", choices=SAMPLE_STATES)
    sample_add.add_argument("--substance", default=None)
    sample_add.add_argument("--amount", type=float, default=None)
    sample_add.add_argument("--unit", default=None)
    sample_add.add_argument("--location", default=None)
    sample_add.add_argument("--owner", default=None)
    sample_add.add_argument("--notes", default=None)
    sample_add.set_defaults(func=cmd_sample_add)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
