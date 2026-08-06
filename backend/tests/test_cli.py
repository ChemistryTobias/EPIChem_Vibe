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


def test_init_db_creates_schema(monkeypatch, tmp_path, capsys):
    from sqlalchemy import create_engine, inspect

    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}")
    monkeypatch.setattr(cli, "engine", engine)

    cli.main(["init-db"])

    assert "devices" in inspect(engine).get_table_names()
    assert str(db_path) in capsys.readouterr().out


def test_reconcile_against_example_descriptors(
    session, monkeypatch, capsys, example_descriptors_dir
):
    monkeypatch.setattr(cli, "SessionLocal", lambda: session)

    cli.main(["reconcile", "--descriptors-dir", str(example_descriptors_dir)])

    out = capsys.readouterr().out
    assert "[created  ] Device          DEV-HP-001" in out
    assert "[created  ] Device          DEV-ST-001" in out


def test_reconcile_exits_nonzero_on_error(session, monkeypatch, tmp_path):
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
        cli.main(["reconcile", "--descriptors-dir", str(tmp_path)])

    assert exc_info.value.code == 1
