#!/usr/bin/env python3
"""Build a release .app, launch it, request ordinary Quit, verify app and service exit."""
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parent.parent

def wait_until(check, seconds, description):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.05)
    raise RuntimeError(f"Timed out: {description}")

def group_exists(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False


def main():
    subprocess.run(["swift", "build", "--disable-sandbox", "-c", "release", "--product", "FIAWorkbenchExample"], cwd=ROOT, check=True)
    binary_dir = subprocess.check_output(["swift", "build", "--disable-sandbox", "-c", "release", "--show-bin-path"], cwd=ROOT, text=True).strip()
    app = ROOT / ".fia" / "smoke" / "FIA Native Workbench.app"
    executable = app / "Contents" / "MacOS" / "FIAWorkbenchExample"
    executable.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(binary_dir) / "FIAWorkbenchExample", executable)
    with (app / "Contents" / "Info.plist").open("wb") as file:
        plistlib.dump({"CFBundleExecutable": executable.name, "CFBundleIdentifier": "dev.fia.native-workbench", "CFBundleName": "FIA Native Workbench", "CFBundlePackageType": "APPL", "LSMinimumSystemVersion": "14.0", "NSHighResolutionCapable": True}, file)
    subprocess.run(["codesign", "--force", "--sign", "-", str(app)], check=True)
    token = str(uuid.uuid4())
    for phase in ("initial", "restore"):
        with tempfile.TemporaryDirectory(prefix="fia-workbench-smoke-") as directory:
            ready = Path(directory) / "ready.json"
            environment = dict(os.environ, FIA_WORKBENCH_READY=str(ready), FIA_WORKBENCH_COOKIE=token, FIA_WORKBENCH_RESTORE="1" if phase == "restore" else "0")
            environment.pop("FIA_HEADLESS", None)
            with (ROOT / ".fia" / "smoke" / f"workbench-{phase}.log").open("w") as log:
                process = subprocess.Popen([str(executable)], env=environment, stdout=log, stderr=log)
                try:
                    wait_until(lambda: ready.exists() or Path(str(ready) + ".error").exists() or process.poll() is not None, 20, "window and service ready")
                    if Path(str(ready) + ".error").exists():
                        raise RuntimeError(Path(str(ready) + ".error").read_text())
                    if not ready.exists():
                        raise RuntimeError(f"Application exited before readiness: {process.returncode}")
                    state = json.loads(ready.read_text())
                    Path(str(ready) + ".quit").touch()
                    try:
                        status = process.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        subprocess.run(["sample", str(process.pid), "1", "-file", str(ROOT / ".fia" / "smoke" / "timeout.sample.txt")], stdout=log, stderr=log, timeout=15)
                        raise
                    if status != 0:
                        raise RuntimeError("Application exit failed")
                    wait_until(lambda: not group_exists(state["servicePID"]), 3, "service process group exit")
                    print(json.dumps({"ok": True, "phase": phase, "application": str(app), "appPID": state["appPID"], "servicePID": state["servicePID"], "checks": ["release-launch", "window-ready", "service-ready", "ordinary-quit", "service-group-exited", "cookie-isolation", "cookie-persistence"]}))
                finally:
                    if process.poll() is None:
                        # Signal only this live Popen child; do not trust stale PID files for cleanup.
                        process.kill()
                        process.wait()

if __name__ == "__main__":
    main()
