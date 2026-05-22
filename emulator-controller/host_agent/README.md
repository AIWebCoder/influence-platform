# emulator-host-agent

Tiny HTTP service that runs on the **host** (where the Android SDK lives) and exposes the local `emulator` binary to the dockerized `emulator-controller`.

This enables **Launch AVD** in the dashboard. The controller cannot run AVDs inside Docker (no KVM passthrough), so it delegates SDK calls to this agent. ADB devices launched on the host appear in the controller because `ADB_HOST=host.docker.internal` points at the host adb server.

## Quick start

### Linux / macOS

```bash
cd emulator-controller/host_agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export EMULATOR_AGENT_TOKEN="$(openssl rand -hex 32)"
export EMULATOR_AGENT_HOST=0.0.0.0
export EMULATOR_AGENT_PORT=19200
# Optional if emulator is not on PATH:
# export ANDROID_SDK_ROOT=/path/to/Android/Sdk

python agent.py
```

### Windows (Docker Desktop)

Install **Android Studio** (SDK + at least one AVD in Device Manager), then:

```powershell
cd emulator-controller\host_agent
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt

$env:EMULATOR_AGENT_TOKEN = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
$env:EMULATOR_AGENT_HOST = "0.0.0.0"
$env:EMULATOR_AGENT_PORT = "19200"
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
# Or: $env:EMULATOR_PATH = "$env:ANDROID_SDK_ROOT\emulator\emulator.exe"

python agent.py
```

Verify on the host:

```powershell
curl -H "Authorization: Bearer $env:EMULATOR_AGENT_TOKEN" http://127.0.0.1:19200/avds
```

Add to the project `.env` (same token on both sides):

```env
EMULATOR_AGENT_URL=http://host.docker.internal:19200
EMULATOR_AGENT_TOKEN=<same token>
```

Restart the controller: `docker compose up -d emulator-controller`

Verify from the host:

```bash
curl -s -H "Authorization: Bearer $EMULATOR_AGENT_TOKEN" http://127.0.0.1:19200/healthz
curl -s -H "Authorization: Bearer $EMULATOR_AGENT_TOKEN" http://127.0.0.1:19200/avds
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Liveness + resolved emulator binary path |
| GET | `/avds` | `emulator -list-avds` |
| GET | `/preflight` | Acceleration check (KVM on Linux, `emulator -accel-check` on Windows/macOS) + AVD list |
| POST | `/launch` | Start an AVD (`{"avd_name":"...", "headless": true}`) |
| POST | `/stop` | End session (`{"serial":"emulator-5556"}`) — runs **host-local** `adb emu kill` (required when the controller runs in Docker) |

All endpoints except `/healthz` require `Authorization: Bearer <token>` when `EMULATOR_AGENT_TOKEN` is set.

## systemd (optional)

```ini
[Unit]
Description=Emulator host agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/influence-platform/emulator-controller/host_agent
EnvironmentFile=/opt/influence-platform/.env
ExecStart=/opt/influence-platform/emulator-controller/host_agent/.venv/bin/python agent.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Bind to `127.0.0.1` unless the Docker gateway must reach the agent; on Linux compose adds `host.docker.internal:host-gateway`.
