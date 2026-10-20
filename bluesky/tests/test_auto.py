"""expose(): drivers -> ophyd devices + plans, straight from signatures and docstrings."""

import inspect
import os

import pytest

os.environ.setdefault("EPICHEM_SIM_SPEED", "500")

from bluesky import RunEngine

from epichem_pod import expose
from epichem_pod.auto import parse_docstring
from epichem_pod.cli import main
from epichem_pod.drivers.sim import SimHotplate, SimPipette


def test_google_style_ranges_like_instrument_drivers_write_them():
    summary, params = parse_docstring(
        """Adjust the SET temperature value.

        Args:
            T_SET (int, [0, self.T_max]): Temperature setpoint [°C].
            speed (int, [0, 1], default 1): 0=slow, 1=normal.
                Standard applications require normal speed.
        """
    )
    assert summary == "Adjust the SET temperature value."
    assert "min" not in params["T_SET"]  # [0, self.T_max] isn't numeric: no range invented
    assert params["speed"]["min"] == 0 and params["speed"]["max"] == 1
    assert params["speed"]["description"].endswith("require normal speed.")


def test_numpy_and_sphinx_styles():
    _, numpy = parse_docstring("Do it.\n\nParameters\n----------\nvolume : float\n    Volume in uL, [0, 300].\n")
    assert numpy["volume"] == {"description": "Volume in uL, [0, 300].", "min": 0.0, "max": 300.0}
    _, sphinx = parse_docstring("Do it.\n\n:param rpm: Speed in rpm.\n")
    assert sphinx["rpm"]["description"] == "Speed in rpm."


@pytest.fixture
def station():
    ns = {"hotplate": SimHotplate(T_max=300), "pipette": SimPipette(), "label": "not a driver", "n": 3}
    ns["pipette"].initialize_dosing_drive()
    found = expose(ns)
    return ns, found


def test_drivers_become_devices_and_everything_else_is_left_alone(station):
    ns, found = station
    assert set(found) == {"hotplate", "pipette"}
    assert ns["label"] == "not a driver" and ns["n"] == 3
    readings = ns["hotplate"].read()
    assert readings["hotplate_temperature"]["value"] == pytest.approx(21.0)
    assert "read_devices" in ns and "RE" in ns


def test_one_plan_per_action_method_with_its_signature(station):
    ns, _ = station
    plan = ns["hotplate_set_temperature_setpoint"]
    assert inspect.isgeneratorfunction(plan)
    assert str(inspect.signature(plan)) == "(T_SET: int)"
    assert plan.__module__ == "epichem_pod.auto.hotplate_low_level"
    assert plan._custom_parameter_annotation_["parameters"]["T_SET"] == {
        "description": "Temperature setpoint [degC].", "min": 0.0, "max": 300.0,
    }
    assert "hotplate_get_temperature" not in ns  # getters are readings, not plans
    assert "pipette_connect" not in ns  # lifecycle methods are left out


def test_generated_plans_run_and_driver_errors_surface(station):
    ns, _ = station
    RE = RunEngine({})
    RE(ns["hotplate_set_temperature_setpoint"](T_SET=80))
    RE(ns["hotplate_start_heating"]())
    assert ns["hotplate"].driver.get_temperature_setpoint() == 80
    with pytest.raises(Exception) as failure:
        RE(ns["pipette_aspirate"](aspiration_volume=100))  # no tip
    assert "No tip present" in str(failure.value) or "No tip present" in str(failure.value.__cause__)


def test_init_scaffolds_a_station_that_discovers(tmp_path, capsys):
    main(["init", str(tmp_path / "bench2")])
    assert (tmp_path / "bench2" / "station.py").exists() and (tmp_path / "bench2" / "Dockerfile").exists()
    main(["discover", str(tmp_path / "bench2" / "station.py"), "--json"])
    out = capsys.readouterr().out
    assert '"hotplate"' in out and "warm_up" in out
