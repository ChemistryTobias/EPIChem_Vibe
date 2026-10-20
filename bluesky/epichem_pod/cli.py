"""`epichem-pod` -- scaffold, inspect and serve a station pod (Roadmap 1.3; docs/BLUESKY.md).

    epichem-pod init my-station                     # station.py + Dockerfile to start from
    epichem-pod discover my-station/station.py      # what expose() finds: devices, plans, parameters
    epichem-pod serve my-station/station.py --epichem http://localhost:8000

`serve` runs everything a station needs: Redis (if it's on PATH and none is
running), the queueserver's RE Manager over your station script or profile
directory, bluesky-httpserver in front of it, opens the worker, and -- with
`--epichem` -- announces the pod to EPIChem every 30 s so it shows up under
New Device -> Discover. Options also read environment variables, which is how
the Docker image configures it.
"""

import argparse
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

DATA = Path(__file__).parent / "data"
TEMPLATES = Path(__file__).parent / "templates"


def _exe(name: str) -> str:
    beside = Path(sys.executable).parent / name
    return str(beside) if beside.exists() else (shutil.which(name) or name)


def _target(path: str) -> tuple[Path, list[str], Path]:
    """(path, queueserver startup args, working dir) for a script or a profile directory."""
    target = Path(path).resolve()
    if not target.exists():
        sys.exit(f"epichem-pod: {target} doesn't exist")
    if target.is_dir():
        return target, ["--startup-dir", str(target)], target
    return target, ["--startup-script", str(target)], target.parent


def _station_name(target: Path) -> str:
    if target.is_dir() or target.stem in ("station", "main", "startup"):
        return (target if target.is_dir() else target.parent).name
    return target.stem


def _env(workdir: Path) -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(workdir), env.get("PYTHONPATH")]))
    env["STARTUP_DIR"] = str(workdir)
    return env


# --- init ---------------------------------------------------------------------
def cmd_init(args) -> None:
    directory = Path(args.directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    name = args.name or directory.name
    station = directory / "station.py"
    if station.exists() and not args.force:
        sys.exit(f"epichem-pod: {station} exists (use --force to overwrite)")
    for template in ("station.py", "Dockerfile", "compose.yaml"):
        text = (TEMPLATES / template).read_text().replace("{{name}}", name)
        (directory / template).write_text(text)
    shutil.copy(DATA / "user_group_permissions.yaml", directory / "user_group_permissions.yaml")
    print(f"Created {directory}/:")
    print("  station.py                  your drivers + expose(globals()) -- edit this")
    print("  user_group_permissions.yaml what EPIChem may see and run")
    print("  Dockerfile, compose.yaml    to run it as a container")
    print(f"\nTry it:  epichem-pod discover {station}\n         epichem-pod serve {station} --epichem http://localhost:8000")


# --- discover -------------------------------------------------------------------
def load_namespace(target: Path) -> dict:
    """Execute the station like the worker would (with EPICHEM_LISTING set)."""
    os.environ["EPICHEM_LISTING"] = "1"
    workdir = target if target.is_dir() else target.parent
    os.environ["STARTUP_DIR"] = str(workdir)
    sys.path.insert(0, str(workdir))
    namespace: dict = {"__name__": "__main__"}
    files = sorted(target.glob("*.py")) if target.is_dir() else [target]
    for file in files:
        namespace["__file__"] = str(file)
        exec(compile(file.read_text(), str(file), "exec"), namespace)  # noqa: S102 -- running the user's own station code is the point
    return namespace


def cmd_discover(args) -> None:
    import inspect

    from ophyd import Device

    target, _, _ = _target(args.target)
    ns = load_namespace(target)
    devices = {n: d for n, d in ns.items() if isinstance(d, Device) and not n.startswith("_") and d.parent is None}
    plans = {n: f for n, f in ns.items() if inspect.isgeneratorfunction(f) and not n.startswith("_")}
    if args.json:
        print(json.dumps({"devices": sorted(devices), "plans": {n: str(inspect.signature(f)) for n, f in plans.items()}}, indent=2))
        return
    print(f"{len(devices)} device(s):")
    for name, device in devices.items():
        driver = getattr(device, "driver", None)
        source = f" <- {type(driver).__module__}.{type(driver).__name__}" if driver is not None else ""
        readings = ", ".join(k.removeprefix(f"{name}_") for k in device.describe()) or "-"
        print(f"  {name:18} {type(device).__name__}{source}\n  {'':18} readings: {readings}")
    groups: dict[str, list[str]] = {}
    for name, plan in plans.items():
        groups.setdefault(getattr(plan, "__module__", None) or "__main__", []).append(f"{name}{inspect.signature(plan)}")
    print(f"\n{len(plans)} plan(s):")
    for module, entries in sorted(groups.items()):
        print(f"  [{module}]")
        for entry in sorted(entries):
            print(f"    {entry}")


# --- serve ----------------------------------------------------------------------
def _redis_up(address: str) -> bool:
    host, _, port = address.partition(":")
    try:
        with socket.create_connection((host or "localhost", int(port or 6379)), timeout=1):
            return True
    except OSError:
        return False


def _http(method: str, url: str, key: str, body: dict | None = None, timeout: float = 5) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if key:
        request.add_header("Authorization", f"ApiKey {key}")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read() or b"{}")


def cmd_serve(args) -> None:
    target, startup, workdir = _target(args.target)
    name = args.name or _station_name(target)
    key = args.api_key or secrets.token_hex(16)
    if not re.fullmatch(r"[A-Za-z0-9]+", key):
        sys.exit("epichem-pod: the API key must be letters and digits only (bluesky-httpserver's rule)")
    if not args.api_key:
        print(f"epichem-pod: no API key given, using {key} -- EPIChem needs the same (EPICHEM_QSERVER_API_KEY)")
    prefix = args.redis_prefix or "qs_" + re.sub(r"\W", "_", name)
    state = workdir / ".epichem-pod"
    state.mkdir(exist_ok=True)
    permissions = workdir / "user_group_permissions.yaml"
    if not permissions.exists():
        permissions = DATA / "user_group_permissions.yaml"
    env = _env(workdir)
    children: list[subprocess.Popen] = []

    def stop(*_):
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    if not _redis_up(args.redis):
        host, _, port = args.redis.partition(":")
        if host in ("localhost", "127.0.0.1", "") and shutil.which("redis-server"):
            print(f"epichem-pod: starting redis-server on :{port or 6379}")
            children.append(subprocess.Popen(["redis-server", "--port", port or "6379", "--save", ""], stdout=subprocess.DEVNULL))
            for _ in range(50):
                if _redis_up(args.redis):
                    break
                time.sleep(0.1)
        else:
            sys.exit(f"epichem-pod: no Redis at {args.redis} (install redis-server, or pass --redis host:port)")

    print(f"epichem-pod: listing plans and devices of {target}")
    listing = subprocess.run(
        [_exe("qserver-list-plans-devices"), *startup, "--file-dir", str(state), "--file-name", "existing_plans_and_devices.yaml"],
        env={**env, "EPICHEM_LISTING": "1"},
        check=False,
    )
    if listing.returncode != 0:
        sys.exit("epichem-pod: the station code failed to load -- fix it, then serve again (try `epichem-pod discover`)")

    control, info = f"tcp://*:{args.zmq_port}", f"tcp://*:{args.zmq_port + 10}"
    children.append(
        subprocess.Popen(
            [
                _exe("start-re-manager"), *startup,
                "--existing-plans-devices", str(state / "existing_plans_and_devices.yaml"),
                "--user-group-permissions", str(permissions),
                "--redis-addr", args.redis, "--redis-name-prefix", prefix,
                "--zmq-control-addr", control, "--zmq-info-addr", info,
                "--zmq-publish-console", "ON",
            ],
            env=env,
        )
    )
    children.append(
        subprocess.Popen(
            [_exe("uvicorn"), "--host", args.host, "--port", str(args.port), "bluesky_httpserver.server:app"],
            env={
                **env,
                "QSERVER_HTTP_SERVER_SINGLE_USER_API_KEY": key,
                "QSERVER_ZMQ_CONTROL_ADDRESS": f"tcp://localhost:{args.zmq_port}",
                "QSERVER_ZMQ_INFO_ADDRESS": f"tcp://localhost:{args.zmq_port + 10}",
            },
        )
    )
    local = f"http://localhost:{args.port}/api"
    public = (args.public_url or f"http://{socket.gethostname()}:{args.port}").rstrip("/")

    def open_worker():
        for _ in range(120):
            try:
                status = _http("GET", f"{local}/status", key)
                if not status.get("worker_environment_exists"):
                    _http("POST", f"{local}/environment/open", key)
                print(f"epichem-pod: {name} is up at {public}")
                return
            except Exception:
                time.sleep(1)
        print("epichem-pod: the RE Manager didn't come up; worker left closed", file=sys.stderr)

    def announce():
        url = f"{args.epichem.rstrip('/')}/api/v1/discovery/announce"
        while True:
            try:
                devices = _http("GET", f"{local}/devices/allowed", key).get("devices_allowed", {})
                plans = _http("GET", f"{local}/plans/allowed", key).get("plans_allowed", {})
                _http(
                    "POST",
                    url,
                    key,
                    {
                        "url": public,
                        "station": name,
                        "description": args.description,
                        "devices": {n: {"classname": d.get("classname"), "module": d.get("module")} for n, d in devices.items()},
                        "plans": sorted(plans),
                    },
                )
            except Exception as exc:
                print(f"epichem-pod: announcing to {args.epichem} failed ({exc}); retrying", file=sys.stderr)
            time.sleep(30)

    threading.Thread(target=open_worker, daemon=True).start()
    if args.epichem:
        threading.Thread(target=announce, daemon=True).start()

    while True:  # the pod is done when any of its processes is
        for child in children:
            if child.poll() is not None:
                print(f"epichem-pod: {Path(child.args[0]).name} exited ({child.returncode})", file=sys.stderr)
                stop()
        time.sleep(1)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="epichem-pod", description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)

    init = commands.add_parser("init", help="scaffold a station directory")
    init.add_argument("directory")
    init.add_argument("--name", help="station name (default: the directory's)")
    init.add_argument("--force", action="store_true")
    init.set_defaults(func=cmd_init)

    discover = commands.add_parser("discover", help="show the devices and plans a station exposes")
    discover.add_argument("target", help="station.py or a profile directory")
    discover.add_argument("--json", action="store_true")
    discover.set_defaults(func=cmd_discover)

    env = os.environ.get
    serve = commands.add_parser("serve", help="run the station: queueserver + HTTP server (+ announce)")
    serve.add_argument("target", help="station.py or a profile directory")
    serve.add_argument("--name", default=env("STATION_NAME"), help="station name shown in EPIChem")
    serve.add_argument("--description", default=env("STATION_DESCRIPTION"))
    serve.add_argument("--host", default=env("EPICHEM_POD_HOST", "0.0.0.0"))
    serve.add_argument("--port", type=int, default=int(env("EPICHEM_POD_PORT", "60610")))
    serve.add_argument("--zmq-port", type=int, default=int(env("EPICHEM_POD_ZMQ_PORT", "60615")),
                       help="RE Manager control port (info uses +10); change it to run two pods on one host")
    serve.add_argument("--redis", default=env("REDIS_ADDR", "localhost:6379"))
    serve.add_argument("--redis-prefix", default=env("REDIS_PREFIX"))
    serve.add_argument("--api-key", default=env("QSERVER_HTTP_SERVER_SINGLE_USER_API_KEY") or env("EPICHEM_QSERVER_API_KEY"))
    serve.add_argument("--epichem", default=env("EPICHEM_URL"), help="EPIChem's URL, to announce this pod to")
    serve.add_argument("--public-url", default=env("EPICHEM_POD_URL"), help="how EPIChem reaches this pod")
    serve.set_defaults(func=cmd_serve)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
