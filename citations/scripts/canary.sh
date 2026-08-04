#!/usr/bin/env bash
# Runs the paid-query canary and alerts on failure. Driven by
# tollgate-canary.timer; all output goes to journald.
#
# Alerts reuse the SOLVENT Telegram bot creds already on the box. If that file or
# its vars are absent the probe still runs and still fails loudly in the journal,
# it just cannot page anyone.
set -uo pipefail

APP_DIR="${TOLLGATE_APP_DIR:-/opt/tollgate}"
TG_CONF="/etc/solvent/telegram-alerts"

tg_send() {
  local msg="$1"
  if [ ! -r "$TG_CONF" ]; then
    echo "canary: telegram creds absent, alert skipped: $msg"
    return 0
  fi
  # shellcheck disable=SC1090
  . "$TG_CONF"
  local token="${SOLVENT_TG_BOT_TOKEN:-}"
  local chat="${SOLVENT_TG_CHAT_ID:-}"
  if [ -z "$token" ] || [ -z "$chat" ]; then
    echo "canary: telegram vars missing in $TG_CONF, alert skipped: $msg"
    return 0
  fi
  curl -fsS -m 10 "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=${chat}" \
    --data-urlencode "text=[tollgate-canary] ${msg}" >/dev/null \
    || echo "canary: telegram send failed: $msg"
}

cd "$APP_DIR" || {
  tg_send "cannot enter $APP_DIR — canary did not run"
  exit 1
}

output=$(node scripts/canary-paid-query.mjs 2>&1)
status=$?
echo "$output"

if [ "$status" -ne 0 ]; then
  # Last line carries the thrown message; the rest is stack noise.
  tg_send "paid-query canary FAILED: $(printf '%s' "$output" | tail -n 1)"
fi

exit "$status"
