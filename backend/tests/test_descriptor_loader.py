from epichem.descriptors.loader import load_descriptors
from epichem.schemas.descriptor import CapabilityClassSpec, DeviceSpec, StationSpec


def test_example_virtual_lab_loads_with_no_errors(example_descriptors_dir):
    result = load_descriptors(example_descriptors_dir)

    assert result.errors == []
    kinds = sorted(d.kind for d in result.descriptors)
    assert kinds == sorted(
        ["Site", "Lab", "Zone", "Workcell", "Bench", "Station", "Station"]
        + ["CapabilityClass"] * 3
        + ["Device"] * 2
    )


def test_device_spec_parses_envelope_and_capabilities(example_descriptors_dir):
    result = load_descriptors(example_descriptors_dir)
    hotplate = next(d for d in result.descriptors if d.metadata.code == "DEV-HP-001")

    spec = hotplate.typed_spec()
    assert isinstance(spec, DeviceSpec)
    assert spec.class_ == "epichem.classes.HeaterStirrer"
    assert spec.capabilities == ["heat", "stir", "read_temperature"]
    assert spec.envelope["temperature_c"].min == 20
    assert spec.envelope["temperature_c"].max == 300
    assert spec.location.station == "HP1"


def test_capability_class_spec_parses_actions(example_descriptors_dir):
    result = load_descriptors(example_descriptors_dir)
    heater_stirrer = next(
        d for d in result.descriptors if d.metadata.code == "CLASS-HEATER-STIRRER"
    )

    spec = heater_stirrer.typed_spec()
    assert isinstance(spec, CapabilityClassSpec)
    assert set(spec.actions) == {"heat", "stir"}
    assert spec.actions["heat"].plan == "mpifkf_plans.thermal:set_temperature"


def test_station_spec_defaults(tmp_path):
    (tmp_path / "station.yaml").write_text(
        """
apiVersion: epichem.dev/v1
kind: Station
metadata:
  code: ST-MIN
  name: Minimal Station
spec:
  bench: BENCH-A2
"""
    )

    result = load_descriptors(tmp_path)

    assert result.errors == []
    spec = result.descriptors[0].typed_spec()
    assert isinstance(spec, StationSpec)
    assert spec.kind == "generic"
    assert spec.capacity == 1


def test_malformed_yaml_is_collected_not_raised(tmp_path):
    (tmp_path / "bad.yaml").write_text("apiVersion: [unterminated")
    (tmp_path / "good.yaml").write_text(
        """
apiVersion: epichem.dev/v1
kind: Site
metadata:
  code: SITE-OK
  name: Site OK
spec: {}
"""
    )

    result = load_descriptors(tmp_path)

    assert len(result.descriptors) == 1
    assert result.descriptors[0].metadata.code == "SITE-OK"
    assert len(result.errors) == 1
    assert "bad.yaml" in str(result.errors[0])


def test_envelope_max_below_min_is_rejected(tmp_path):
    (tmp_path / "device.yaml").write_text(
        """
apiVersion: epichem.dev/v1
kind: Device
metadata:
  code: DEV-BAD
  name: Bad Device
spec:
  class: epichem.classes.HeaterStirrer
  transport: {protocol: sim}
  envelope:
    temperature_c: {min: 300, max: 20}
"""
    )

    result = load_descriptors(tmp_path)

    assert result.descriptors == []
    assert len(result.errors) == 1
    assert "envelope" in str(result.errors[0]).lower()
