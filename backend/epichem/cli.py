"""CLI (§8.3 subset). "The CLI must be able to do everything the UI can" —
at M1 scope that's: create the schema, reconcile descriptors, and list what's
registered.
"""

import argparse
import sys
from pathlib import Path

from sqlalchemy import select

from epichem.db import SessionLocal, engine
from epichem.models import Base, Device


def cmd_init_db(_args: argparse.Namespace) -> None:
    Base.metadata.create_all(engine)
    print(f"Initialized schema on {engine.url}")


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


def cmd_reconcile(args: argparse.Namespace) -> None:
    from epichem.reconciler import reconcile  # local: keeps the CLI importable before this exists

    with SessionLocal() as session:
        report = reconcile(session, args.descriptors_dir)
        session.commit()
    _print_reconcile_report(report)
    if not report.ok:
        sys.exit(1)


def _print_reconcile_report(report) -> None:
    for item in [*report.items, *report.drift]:
        detail = f"  {item.detail}" if item.detail else ""
        print(f"[{item.action:<9}] {item.kind:<15} {item.code}{detail}")
    for err in report.loader_errors:
        print(f"[error    ] {err}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="epichem")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="Create the registry schema").set_defaults(func=cmd_init_db)

    reconcile_parser = sub.add_parser(
        "reconcile", help="Reconcile git-backed descriptors into the registry"
    )
    reconcile_parser.add_argument("--descriptors-dir", type=Path, required=True)
    reconcile_parser.set_defaults(func=cmd_reconcile)

    device_parser = sub.add_parser("device", help="Device commands")
    device_sub = device_parser.add_subparsers(dest="device_command", required=True)
    device_sub.add_parser("list", help="List registered devices").set_defaults(func=cmd_device_list)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
