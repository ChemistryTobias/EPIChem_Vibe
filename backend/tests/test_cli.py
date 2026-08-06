import pytest

from epichem import cli
from epichem.models import CapabilityClass, Device


def test_device_list_prints_registered_devices(session, monkeypatch, capsys):
    cc = CapabilityClass(name="HeaterStirrer", actions={"heat": {}})
    session.add(cc)
    session.flush()
    session.add(
        Device(
            code="DEV-HP-001",
            name="Hotplate H1",
            capability_class_id=cc.id,
            capabilities=["heat"],
        )
    )
    session.commit()

    monkeypatch.setattr(cli, "SessionLocal", lambda: session)

    cli.main(["device", "list"])

    out = capsys.readouterr().out
    assert "DEV-HP-001" in out
    assert "heat" in out


def test_device_list_empty(session, monkeypatch, capsys):
    monkeypatch.setattr(cli, "SessionLocal", lambda: session)

    cli.main(["device", "list"])

    assert "No devices registered." in capsys.readouterr().out


def test_init_db_runs_migrations_to_head(monkeypatch, tmp_path, capsys):
    from sqlalchemy import create_engine, inspect

    db_path = tmp_path / "test.db"
    # init-db goes through Alembic now, and Alembic opens its own connection
    # from DATABASE_URL — so point the env var, not just cli.engine.
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    engine = create_engine(f"sqlite:///{db_path}")
    monkeypatch.setattr(cli, "engine", engine)

    cli.main(["init-db"])

    tables = inspect(engine).get_table_names()
    assert "devices" in tables
    assert "alembic_version" in tables  # i.e. it was migrated, not create_all'd
    assert str(db_path) in capsys.readouterr().out


def test_db_current_reports_head(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'cur.db'}")
    cli.main(["init-db"])
    capsys.readouterr()

    cli.main(["db", "current"])

    assert "0001" in capsys.readouterr().out


def test_import_dir_against_example_descriptors(
    session, monkeypatch, capsys, example_descriptors_dir
):
    monkeypatch.setattr(cli, "SessionLocal", lambda: session)

    cli.main(["import-dir", "--descriptors-dir", str(example_descriptors_dir)])

    out = capsys.readouterr().out
    assert "[created  ] Device          DEV-HP-001" in out
    assert "[created  ] Device          DEV-ST-001" in out


def test_import_dir_exits_nonzero_on_error(session, monkeypatch, tmp_path):
    (tmp_path / "device.yaml").write_text(
        """
apiVersion: epichem.dev/v1
kind: Device
metadata:
  code: DEV-BAD
  name: Bad Device
spec:
  class: epichem.classes.Nonexistent
  transport: {protocol: sim}
"""
    )
    monkeypatch.setattr(cli, "SessionLocal", lambda: session)

    with pytest.raises(SystemExit) as exc_info:
        cli.main(["import-dir", "--descriptors-dir", str(tmp_path)])

    assert exc_info.value.code == 1


def test_export_dir_writes_yaml_tree(
    session, monkeypatch, capsys, example_descriptors_dir, tmp_path
):
    monkeypatch.setattr(cli, "SessionLocal", lambda: session)
    cli.main(["import-dir", "--descriptors-dir", str(example_descriptors_dir)])
    capsys.readouterr()

    out_dir = tmp_path / "export"
    cli.main(["export-dir", "--out-dir", str(out_dir)])

    out = capsys.readouterr().out
    assert "wrote" in out
    assert (out_dir / "devices" / "dev-hp-001.yaml").exists()


def test_device_export_import_round_trip(
    session, monkeypatch, capsys, example_descriptors_dir, tmp_path
):
    monkeypatch.setattr(cli, "SessionLocal", lambda: session)
    cli.main(["import-dir", "--descriptors-dir", str(example_descriptors_dir)])
    capsys.readouterr()

    out_file = tmp_path / "dev-hp-001.yaml"
    cli.main(["device", "export", "DEV-HP-001", "-o", str(out_file)])
    assert out_file.exists()

    cli.main(["device", "import", str(out_file)])
    out = capsys.readouterr().out
    assert "[unchanged] Device          DEV-HP-001" in out


def test_device_export_missing_code_exits_nonzero(session, monkeypatch):
    monkeypatch.setattr(cli, "SessionLocal", lambda: session)

    with pytest.raises(SystemExit) as exc_info:
        cli.main(["device", "export", "DEV-NOPE"])

    assert exc_info.value.code == 1


def test_sample_add_then_list(session, monkeypatch, capsys):
    monkeypatch.setattr(cli, "SessionLocal", lambda: session)

    cli.main(
        [
            "sample",
            "add",
            "SMP-2026-0041",
            "PEDOT:PSS film",
            "--state",
            "staged",
            "--amount",
            "1.5",
            "--unit",
            "mL",
            "--location",
            "RACK-A/3",
        ]
    )
    assert "[created  ] Sample           SMP-2026-0041" in capsys.readouterr().out

    cli.main(["sample", "list"])
    out = capsys.readouterr().out
    assert "SMP-2026-0041" in out
    assert "staged" in out
    assert "RACK-A/3" in out


def test_sample_add_duplicate_code_exits_nonzero(session, monkeypatch, capsys):
    monkeypatch.setattr(cli, "SessionLocal", lambda: session)
    cli.main(["sample", "add", "SMP-DUP", "First"])
    capsys.readouterr()

    with pytest.raises(SystemExit) as exc_info:
        cli.main(["sample", "add", "SMP-DUP", "Second"])

    assert exc_info.value.code == 1


def test_sample_list_empty(session, monkeypatch, capsys):
    monkeypatch.setattr(cli, "SessionLocal", lambda: session)

    cli.main(["sample", "list"])

    assert "No samples registered." in capsys.readouterr().out
