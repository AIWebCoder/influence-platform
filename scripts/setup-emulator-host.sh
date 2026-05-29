#!/usr/bin/env bash
# ─────────────────────────────────────────
# Influence Platform — Emulator Host Setup
#
# Installs everything needed to launch Android AVDs from the dashboard's
# "Launch AVD" tab on the machine where the Android SDK lives.
#
# Idempotent: safe to re-run. Each step skips if the artefact already exists,
# unless --force is passed.
#
# Run on the host that will actually run emulators (must have KVM-capable CPU
# for x86_64 system images; check with `grep -E "vmx|svm" /proc/cpuinfo`).
#
# Usage:
#   sudo ./scripts/setup-emulator-host.sh              # full install
#   sudo ./scripts/setup-emulator-host.sh --help       # show flags
#   sudo SDK_API_LEVEL=33 ./scripts/setup-emulator-host.sh
#
# After completion the script prints the EMULATOR_AGENT_URL and TOKEN to put
# in the controller's .env (or auto-updates the local .env if --update-env).
# ─────────────────────────────────────────

set -euo pipefail

# ── Config (env vars or defaults) ────────────────────────────────────────────

ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$ANDROID_SDK_ROOT/avd}"
SDK_API_LEVEL="${SDK_API_LEVEL:-30}"
SDK_VARIANT="${SDK_VARIANT:-default}"
SDK_ABI="${SDK_ABI:-x86_64}"
AVD_NAME="${AVD_NAME:-Pixel_API_${SDK_API_LEVEL}}"
DEVICE_PROFILE="${DEVICE_PROFILE:-pixel}"

REPO_ROOT_DEFAULT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &>/dev/null && pwd)"
REPO_ROOT="${REPO_ROOT:-$REPO_ROOT_DEFAULT}"
AGENT_DIR="${AGENT_DIR:-$REPO_ROOT/emulator-controller/host_agent}"
AGENT_USER="${AGENT_USER:-root}"
AGENT_HOST="${EMULATOR_AGENT_HOST:-0.0.0.0}"
AGENT_PORT="${EMULATOR_AGENT_PORT:-19200}"
TOKEN="${EMULATOR_AGENT_TOKEN:-}"

ADB_PORT="${ADB_PORT:-5037}"
DOCKER_SUBNETS="${DOCKER_SUBNETS:-172.17.0.0/16 172.18.0.0/16}"

ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
UPDATE_ENV=0
SKIP_SDK=0
SKIP_AVD=0
SKIP_ADB_SERVICE=0
SKIP_AGENT_SERVICE=0
SKIP_FIREWALL=0
FORCE=0
CHECK_ONLY=0

# ── CLI ──────────────────────────────────────────────────────────────────────

usage() {
  cat <<USAGE
Sets up the Android SDK, an AVD, and the host services needed by the
influence-platform dashboard's "Launch AVD" feature.

Flags:
  --update-env             write EMULATOR_AGENT_URL/TOKEN to \$ENV_FILE
  --skip-sdk               do not install/update the Android SDK
  --skip-avd               do not create the AVD
  --skip-adb-service       do not install adb-server.service
  --skip-agent-service     do not install emulator-host-agent.service
  --skip-firewall          do not touch ufw
  --force                  re-create services even when already present
  --check                  verify KVM / SDK / AVD / services and run a short
                           emulator smoke test, then exit (no install steps)
  --help                   show this help

Environment overrides (defaults shown):
  ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT
  SDK_API_LEVEL=$SDK_API_LEVEL
  SDK_VARIANT=$SDK_VARIANT             # default, google_apis, google_apis_playstore
  SDK_ABI=$SDK_ABI                     # x86_64 (needs KVM), arm64-v8a (Apple silicon hosts)
  AVD_NAME=$AVD_NAME
  DEVICE_PROFILE=$DEVICE_PROFILE
  EMULATOR_AGENT_HOST=$AGENT_HOST
  EMULATOR_AGENT_PORT=$AGENT_PORT
  EMULATOR_AGENT_TOKEN=<random-32-hex>
  ADB_PORT=$ADB_PORT
  DOCKER_SUBNETS="$DOCKER_SUBNETS"
  ENV_FILE=$ENV_FILE
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --update-env)         UPDATE_ENV=1 ;;
    --skip-sdk)           SKIP_SDK=1 ;;
    --skip-avd)           SKIP_AVD=1 ;;
    --skip-adb-service)   SKIP_ADB_SERVICE=1 ;;
    --skip-agent-service) SKIP_AGENT_SERVICE=1 ;;
    --skip-firewall)      SKIP_FIREWALL=1 ;;
    --force)              FORCE=1 ;;
    --check)              CHECK_ONLY=1 ;;
    -h|--help)            usage; exit 0 ;;
    *) echo "Unknown flag: $1"; usage; exit 2 ;;
  esac
  shift
done

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { printf '\033[1;36m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n'  "$*" >&2; }
err()  { printf '\033[1;31m[err]\033[0m %s\n'   "$*" >&2; }
pass() { printf '  \033[1;32mok\033[0m   %s\n' "$*"; }
fail() { printf '  \033[1;31mFAIL\033[0m %s\n' "$*"; }
note() { printf '  \033[1;33mwarn\033[0m %s\n' "$*"; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    err "must run as root (try: sudo $0 $*)"
    exit 1
  fi
}

apt_install() {
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

ensure_packages() {
  local missing=()
  for pkg in "$@"; do
    dpkg -s "$pkg" &>/dev/null || missing+=("$pkg")
  done
  if (( ${#missing[@]} )); then
    log "installing packages: ${missing[*]}"
    apt-get update -qq
    apt_install "${missing[@]}" >/dev/null
  fi
}

# ── Preflight ────────────────────────────────────────────────────────────────

require_root

if [[ ! -d "$AGENT_DIR" ]]; then
  err "host_agent directory not found at $AGENT_DIR"
  err "set REPO_ROOT or AGENT_DIR if running outside the influence-platform repo"
  exit 1
fi

log "preflight checks"
log "  ANDROID_SDK_ROOT = $ANDROID_SDK_ROOT"
log "  AVD              = $AVD_NAME ($SDK_VARIANT/$SDK_ABI, API $SDK_API_LEVEL)"
log "  AGENT_DIR        = $AGENT_DIR"
log "  ENV_FILE         = $ENV_FILE (update=$UPDATE_ENV)"

if [[ "$SDK_ABI" == "x86_64" ]]; then
  if grep -qE '^(flags|Features).*\b(vmx|svm)\b' /proc/cpuinfo; then
    log "  KVM-capable CPU detected"
  else
    warn "no vmx/svm flags in /proc/cpuinfo — x86_64 emulator will refuse to start."
    warn "options: (1) enable nested virt on the hypervisor, (2) use SDK_ABI=arm64-v8a"
    warn "         on an Apple-silicon host, or (3) only use 'Connect via ADB' in the UI."
    warn "continuing setup so the integration is ready when KVM becomes available."
  fi
fi

# Paths used by both --check and the install flow.
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
SDKMANAGER="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/avdmanager"
EMULATOR_BIN="$ANDROID_SDK_ROOT/emulator/emulator"

# ── --check mode (verification only, no install) ─────────────────────────────

run_checks() {
  local failures=0
  echo
  echo "─── Host capability checks ────────────────────────────────────────────"

  if grep -qE '^(flags|Features).*\b(vmx|svm)\b' /proc/cpuinfo; then
    pass "CPU exposes vmx/svm"
  else
    fail "no vmx/svm flags in /proc/cpuinfo — hypervisor has not enabled nested virt for this VM"
    failures=$((failures+1))
  fi

  if [[ -e /dev/kvm ]]; then
    if [[ -r /dev/kvm && -w /dev/kvm ]]; then
      pass "/dev/kvm exists and is read/write"
    else
      note "/dev/kvm exists but is not r/w for this user ($(id -un)). Add user to the 'kvm' group or run with sudo."
      failures=$((failures+1))
    fi
  else
    fail "/dev/kvm missing — no KVM available, x86_64 emulator will not start"
    failures=$((failures+1))
  fi

  if lsmod 2>/dev/null | grep -qE '^kvm(_intel|_amd)?\b'; then
    pass "kvm kernel module loaded ($(lsmod | grep -E '^kvm' | awk '{print $1}' | xargs))"
  else
    note "kvm kernel module not loaded (modprobe kvm_intel or kvm_amd)"
  fi

  echo
  echo "─── Android SDK ───────────────────────────────────────────────────────"
  if [[ -x "$EMULATOR_BIN" ]]; then
    pass "emulator binary at $EMULATOR_BIN"
  else
    fail "emulator binary missing — run this script without --check to install"
    failures=$((failures+1))
  fi
  if [[ -x "$ANDROID_SDK_ROOT/platform-tools/adb" ]]; then
    pass "adb binary at $ANDROID_SDK_ROOT/platform-tools/adb"
  else
    note "adb binary missing under SDK (system /usr/bin/adb may still be in use)"
  fi

  echo
  echo "─── AVDs ──────────────────────────────────────────────────────────────"
  if [[ -x "$EMULATOR_BIN" ]]; then
    local avd_list
    avd_list=$("$EMULATOR_BIN" -list-avds 2>/dev/null || true)
    if [[ -n "$avd_list" ]]; then
      while IFS= read -r line; do pass "AVD $line"; done <<<"$avd_list"
    else
      fail "no AVDs found"
      failures=$((failures+1))
    fi
  fi

  echo
  echo "─── Services ──────────────────────────────────────────────────────────"
  for svc in adb-server.service emulator-host-agent.service; do
    if systemctl is-active --quiet "$svc"; then
      pass "$svc active"
    else
      if systemctl list-unit-files --no-legend "$svc" &>/dev/null && \
         [[ -n "$(systemctl list-unit-files --no-legend "$svc" 2>/dev/null)" ]]; then
        fail "$svc installed but not active"
      else
        note "$svc not installed"
      fi
      failures=$((failures+1))
    fi
  done

  echo
  echo "─── Emulator smoke test (10s startup, headless) ───────────────────────"
  if [[ ! -x "$EMULATOR_BIN" ]]; then
    note "skipping (emulator binary missing)"
  else
    local avd
    avd=$("$EMULATOR_BIN" -list-avds 2>/dev/null | head -1 || true)
    if [[ -z "$avd" ]]; then
      note "skipping (no AVD to test)"
    else
      local tmplog
      tmplog=$(mktemp)
      ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT" \
      ANDROID_HOME="$ANDROID_SDK_ROOT" \
      ANDROID_AVD_HOME="$ANDROID_AVD_HOME" \
        "$EMULATOR_BIN" -avd "$avd" -no-snapshot-load -no-window -no-audio \
                        -no-boot-anim -no-metrics -gpu swiftshader_indirect \
                        >"$tmplog" 2>&1 &
      local epid=$!
      sleep 10
      if kill -0 "$epid" 2>/dev/null; then
        kill "$epid" 2>/dev/null || true
        wait "$epid" 2>/dev/null || true
        pass "emulator survived 10s startup — booting normally (full boot may take several minutes)"
      else
        wait "$epid" 2>/dev/null || true
        local culprit
        culprit=$(grep -m1 -E 'FATAL|ERROR' "$tmplog" 2>/dev/null || true)
        fail "emulator exited within 10s"
        if [[ -n "$culprit" ]]; then
          printf '       %s\n' "$culprit"
        fi
        printf '       (log: %s)\n' "$tmplog"
        failures=$((failures+1))
      fi
      [[ -f "$tmplog" ]] && rm -f "$tmplog" 2>/dev/null || true
    fi
  fi

  echo
  echo "───────────────────────────────────────────────────────────────────────"
  if (( failures == 0 )); then
    printf ' \033[1;32mAll checks passed.\033[0m Launch AVD in the dashboard should work.\n'
    return 0
  else
    printf ' \033[1;31m%d check(s) failed.\033[0m Address the items above, then re-run --check.\n' "$failures"
    return 1
  fi
}

if (( CHECK_ONLY )); then
  run_checks
  exit $?
fi

# ── 1. Base packages ─────────────────────────────────────────────────────────

ensure_packages \
  openjdk-17-jre-headless \
  unzip curl ca-certificates \
  python3 python3-venv \
  libpulse0 libnss3 libstdc++6 libgl1 libegl1

# ── 2. Android SDK ───────────────────────────────────────────────────────────

if (( ! SKIP_SDK )); then
  if [[ ! -x "$SDKMANAGER" ]]; then
    log "installing Android cmdline-tools at $ANDROID_SDK_ROOT/cmdline-tools/latest"
    mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools"
    tmpzip="$(mktemp --suffix=.zip)"
    trap 'rm -f "$tmpzip"' EXIT
    curl -fsSL -o "$tmpzip" "$CMDLINE_TOOLS_URL"
    rm -rf /tmp/_ip_cmdtools
    mkdir -p /tmp/_ip_cmdtools
    unzip -q -o "$tmpzip" -d /tmp/_ip_cmdtools
    rm -rf "$ANDROID_SDK_ROOT/cmdline-tools/latest"
    mv /tmp/_ip_cmdtools/cmdline-tools "$ANDROID_SDK_ROOT/cmdline-tools/latest"
    rm -f "$tmpzip"
    trap - EXIT
  else
    log "cmdline-tools already present, skipping download"
  fi

  log "accepting SDK licenses"
  yes 2>/dev/null | "$SDKMANAGER" --licenses >/dev/null || true

  log "installing platform-tools, emulator, system-images;android-$SDK_API_LEVEL;$SDK_VARIANT;$SDK_ABI"
  "$SDKMANAGER" \
    "platform-tools" \
    "emulator" \
    "system-images;android-${SDK_API_LEVEL};${SDK_VARIANT};${SDK_ABI}" >/dev/null
else
  log "skipping SDK install (--skip-sdk)"
fi

if [[ ! -x "$EMULATOR_BIN" ]]; then
  warn "emulator binary not found at $EMULATOR_BIN — agent will be installed but won't be able to launch AVDs yet"
fi

# ── 3. AVD ───────────────────────────────────────────────────────────────────

if (( ! SKIP_AVD )); then
  mkdir -p "$ANDROID_AVD_HOME"
  if [[ -d "$ANDROID_AVD_HOME/${AVD_NAME}.avd" ]] && (( ! FORCE )); then
    log "AVD $AVD_NAME already exists, skipping (use --force to recreate)"
  else
    log "creating AVD $AVD_NAME"
    ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT" \
    ANDROID_HOME="$ANDROID_SDK_ROOT" \
    ANDROID_AVD_HOME="$ANDROID_AVD_HOME" \
      bash -c "echo no | '$AVDMANAGER' create avd \
        --name '$AVD_NAME' \
        --package 'system-images;android-${SDK_API_LEVEL};${SDK_VARIANT};${SDK_ABI}' \
        --device '$DEVICE_PROFILE' \
        --force" >/dev/null
  fi
else
  log "skipping AVD creation (--skip-avd)"
fi

# ── 4. Token ─────────────────────────────────────────────────────────────────

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(openssl rand -hex 32)"
  log "generated EMULATOR_AGENT_TOKEN"
else
  log "using provided EMULATOR_AGENT_TOKEN"
fi

# ── 5. adb-server systemd unit ───────────────────────────────────────────────

if (( ! SKIP_ADB_SERVICE )); then
  ADB_BIN="$ANDROID_SDK_ROOT/platform-tools/adb"
  if [[ ! -x "$ADB_BIN" ]]; then
    ADB_BIN="$(command -v adb || true)"
  fi
  if [[ -z "$ADB_BIN" ]]; then
    warn "adb binary not found; skipping adb-server.service"
  else
    log "installing adb-server.service (listening on 0.0.0.0:$ADB_PORT)"
    cat > /etc/systemd/system/adb-server.service <<UNIT
[Unit]
Description=Android Debug Bridge server (listening on all interfaces)
After=network-online.target

[Service]
Type=simple
ExecStart=$ADB_BIN -a -P $ADB_PORT server nodaemon
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable adb-server.service >/dev/null
    if (( FORCE )); then
      systemctl restart adb-server.service
    else
      systemctl start adb-server.service || systemctl restart adb-server.service
    fi
  fi
fi

# ── 6. host-agent venv + systemd unit ────────────────────────────────────────

if (( ! SKIP_AGENT_SERVICE )); then
  log "preparing host-agent venv at $AGENT_DIR/.venv"
  if [[ ! -x "$AGENT_DIR/.venv/bin/python" ]] || (( FORCE )); then
    rm -rf "$AGENT_DIR/.venv"
    python3 -m venv "$AGENT_DIR/.venv"
  fi
  "$AGENT_DIR/.venv/bin/pip" install --quiet --upgrade pip >/dev/null
  "$AGENT_DIR/.venv/bin/pip" install --quiet -r "$AGENT_DIR/requirements.txt" >/dev/null

  log "installing emulator-host-agent.service"
  cat > /etc/systemd/system/emulator-host-agent.service <<UNIT
[Unit]
Description=Emulator host agent for influence-platform
After=network-online.target

[Service]
Type=simple
User=$AGENT_USER
Environment=EMULATOR_AGENT_HOST=$AGENT_HOST
Environment=EMULATOR_AGENT_PORT=$AGENT_PORT
Environment=EMULATOR_AGENT_TOKEN=$TOKEN
Environment=ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT
Environment=ANDROID_HOME=$ANDROID_SDK_ROOT
Environment=ANDROID_AVD_HOME=$ANDROID_AVD_HOME
Environment=EMULATOR_PATH=$EMULATOR_BIN
Environment=PATH=$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/platform-tools:/usr/bin:/bin
WorkingDirectory=$AGENT_DIR
ExecStart=$AGENT_DIR/.venv/bin/python agent.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable emulator-host-agent.service >/dev/null
  systemctl restart emulator-host-agent.service
fi

# ── 7. ufw rules ─────────────────────────────────────────────────────────────

if (( ! SKIP_FIREWALL )) && command -v ufw &>/dev/null; then
  if ufw status 2>/dev/null | head -1 | grep -q 'Status: active'; then
    log "adding ufw rules for ports $AGENT_PORT and $ADB_PORT from $DOCKER_SUBNETS"
    for subnet in $DOCKER_SUBNETS; do
      ufw allow from "$subnet" to any port "$AGENT_PORT" proto tcp \
        comment "emulator-host-agent ($subnet)" >/dev/null || true
      ufw allow from "$subnet" to any port "$ADB_PORT" proto tcp \
        comment "adb-server ($subnet)" >/dev/null || true
    done
  else
    log "ufw not active, skipping firewall rules"
  fi
fi

# ── 8. .env (optional) ───────────────────────────────────────────────────────

AGENT_URL_FOR_CONTROLLER="http://host.docker.internal:$AGENT_PORT"

if (( UPDATE_ENV )); then
  if [[ ! -f "$ENV_FILE" ]]; then
    log "creating $ENV_FILE"
    touch "$ENV_FILE"
  fi
  upsert() {
    local key="$1" value="$2"
    if grep -q "^${key}=" "$ENV_FILE"; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    else
      printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
  }
  upsert EMULATOR_AGENT_URL   "$AGENT_URL_FOR_CONTROLLER"
  upsert EMULATOR_AGENT_TOKEN "$TOKEN"
  log "wrote EMULATOR_AGENT_URL and EMULATOR_AGENT_TOKEN to $ENV_FILE"
fi

# ── 9. Summary ───────────────────────────────────────────────────────────────

echo
echo "─────────────────────────────────────────"
echo " Emulator host setup complete"
echo "─────────────────────────────────────────"

if (( ! SKIP_AGENT_SERVICE )); then
  if systemctl is-active --quiet emulator-host-agent; then
    echo "  emulator-host-agent.service : active"
  else
    echo "  emulator-host-agent.service : NOT active (check: journalctl -u emulator-host-agent -n 30)"
  fi
fi
if (( ! SKIP_ADB_SERVICE )); then
  if systemctl is-active --quiet adb-server; then
    echo "  adb-server.service          : active"
  else
    echo "  adb-server.service          : NOT active (check: journalctl -u adb-server -n 30)"
  fi
fi

echo
echo "Available AVDs:"
"$EMULATOR_BIN" -list-avds 2>/dev/null | sed 's/^/  - /' || echo "  (emulator binary unavailable)"

echo
echo "Configure the controller (on the machine running docker compose) with:"
echo "  EMULATOR_AGENT_URL=$AGENT_URL_FOR_CONTROLLER"
echo "  EMULATOR_AGENT_TOKEN=$TOKEN"
if (( UPDATE_ENV )); then
  echo
  echo "Already written to $ENV_FILE. Apply with:"
  echo "  (cd $REPO_ROOT && docker compose up -d --no-deps --pull never emulator-controller)"
else
  echo
  echo "(re-run with --update-env to write them to $ENV_FILE automatically)"
fi

echo
echo "Smoke test from this host:"
echo "  curl -s -H 'Authorization: Bearer \$EMULATOR_AGENT_TOKEN' http://127.0.0.1:$AGENT_PORT/avds"
