# emulator-host-agent

Tiny HTTP service that runs on the **host** (where the Android SDK lives) and exposes the local `emulator` binary to the dockerized `emulator-controller`.

This enables **Launch AVD** in the dashboard. The controller cannot run AVDs inside Docker (no KVM passthrough), so it delegates SDK calls to this agent. ADB devices launched on the host appear in the controller because `ADB_HOST=host.docker.internal` points at the host adb server.

## Quick start

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
| GET | `/preflight` | KVM + AVD readiness check |
| POST | `/launch` | Start an AVD (`{"avd_name":"...", "headless": true}`) |

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
