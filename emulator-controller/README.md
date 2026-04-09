# Emulator Controller

Parallel Android emulator orchestrator for Instagram automation.

## Responsibilities

- Discover and manage Android emulators over ADB.
- Control Instagram on each emulator via Appium (UiAutomator2).
- Fetch accounts and active campaigns from `distribution-engine`.
- Generate niche-aware content via Claude.
- Log action outcomes into `account_actions` in Postgres.
- Report execution status to `distribution-engine` endpoint.

## Run

```bash
cp .env.example .env
python -m pip install -r requirements.txt
python main.py
```

## Notes

- Run an Appium server separately (or expose one to this container).
- Emulators must be reachable through ADB (`adb devices`).
