#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-}"

if [[ -z "${APP_PATH}" ]]; then
  echo "Usage: $0 /path/to/CoworkAny.app" >&2
  exit 1
fi

if [[ ! -d "${APP_PATH}" ]]; then
  echo "App bundle not found: ${APP_PATH}" >&2
  exit 1
fi

SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"

if [[ -z "${SIGNING_IDENTITY}" ]]; then
  echo "[mac-sign] No APPLE_SIGNING_IDENTITY configured; applying ad-hoc signature"
  codesign --force --deep --sign - "${APP_PATH}"
else
  echo "[mac-sign] Signing ${APP_PATH} with identity: ${SIGNING_IDENTITY}"
  codesign --force --deep --options runtime --timestamp --sign "${SIGNING_IDENTITY}" "${APP_PATH}"
fi

echo "[mac-sign] Verifying codesign"
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

if [[ -n "${SIGNING_IDENTITY}" && -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  echo "[mac-sign] Submitting for notarization"
  xcrun notarytool submit "${APP_PATH}" \
    --apple-id "${APPLE_ID}" \
    --password "${APPLE_PASSWORD}" \
    --team-id "${APPLE_TEAM_ID}" \
    --wait

  echo "[mac-sign] Stapling notarization ticket"
  xcrun stapler staple "${APP_PATH}"

  echo "[mac-sign] Final Gatekeeper check"
  spctl -a -vv "${APP_PATH}"
else
  echo "[mac-sign] Skipping notarization; Apple credentials not fully configured"
fi
