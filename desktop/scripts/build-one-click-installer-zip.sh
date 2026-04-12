#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_OUT_DIR="${DESKTOP_DIR}/artifacts/one-click-install"
INSTALL_SCRIPT_NAME="install-and-authorize-macos.sh"

TARGET=""
OUT_DIR="${DEFAULT_OUT_DIR}"
SOURCE_DMG=""
SKIP_BUILD="0"

TMP_ROOT=""

log() { printf '[one-click-pack] %s\n' "$*"; }
die() { printf '[one-click-pack][error] %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [[ -n "${TMP_ROOT}" && -d "${TMP_ROOT}" ]]; then
    rm -rf "${TMP_ROOT}"
  fi
}
trap cleanup EXIT

print_usage() {
  cat <<'EOF'
Usage:
  build-one-click-installer-zip.sh [--target <tauri-target>] [--out-dir <dir>] [--source-dmg <path>] [--skip-build]

Options:
  --target      Tauri build target. Defaults by host arch:
                arm64 -> aarch64-apple-darwin
                x86_64 -> x86_64-apple-darwin
  --out-dir     Output directory for generated zip file.
  --source-dmg  Use an existing dmg file instead of auto-locating from tauri output.
  --skip-build  Skip "npm run tauri -- build"; only package existing artifacts.
  -h, --help    Show help.

Examples:
  ./desktop/scripts/build-one-click-installer-zip.sh
  ./desktop/scripts/build-one-click-installer-zip.sh --skip-build
  ./desktop/scripts/build-one-click-installer-zip.sh --source-dmg ./desktop/scripts/CoworkAny_0.1.0-beta.2_aarch64.dmg
EOF
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_commands() {
  local missing=()
  for cmd in npm find shasum stat awk zip; do
    if ! command_exists "${cmd}"; then
      missing+=("${cmd}")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    die "Missing required command(s): ${missing[*]}"
  fi
}

file_mtime_seconds() {
  local path="$1"
  if stat -f %m "${path}" >/dev/null 2>&1; then
    stat -f %m "${path}"
  else
    stat -c %Y "${path}"
  fi
}

default_target_from_host() {
  local host_arch
  host_arch="$(uname -m)"
  case "${host_arch}" in
    arm64|aarch64)
      printf 'aarch64-apple-darwin\n'
      ;;
    x86_64|amd64)
      printf 'x86_64-apple-darwin\n'
      ;;
    *)
      die "Unsupported host architecture: ${host_arch}. Please pass --target explicitly."
      ;;
  esac
}

find_latest_matching_dmg() {
  local root="$1"
  local best_path=""
  local best_mtime="-1"
  local candidate=""
  local candidate_mtime=""

  [[ -d "${root}" ]] || return 1
  while IFS= read -r candidate; do
    [[ -n "${candidate}" ]] || continue
    candidate_mtime="$(file_mtime_seconds "${candidate}" || echo 0)"
    if [[ "${candidate_mtime}" -gt "${best_mtime}" ]]; then
      best_mtime="${candidate_mtime}"
      best_path="${candidate}"
    fi
  done < <(find "${root}" -maxdepth 3 -type f -name 'CoworkAny*.dmg' 2>/dev/null)

  [[ -n "${best_path}" ]] || return 1
  printf '%s\n' "${best_path}"
}

resolve_source_dmg() {
  if [[ -n "${SOURCE_DMG}" ]]; then
    [[ -f "${SOURCE_DMG}" ]] || die "--source-dmg not found: ${SOURCE_DMG}"
    printf '%s\n' "${SOURCE_DMG}"
    return 0
  fi

  local bundle_dmg_dir_target="${DESKTOP_DIR}/src-tauri/target/${TARGET}/release/bundle/dmg"
  local bundle_dmg_dir_native="${DESKTOP_DIR}/src-tauri/target/release/bundle/dmg"
  local scripts_dir="${SCRIPT_DIR}"
  local candidate=""

  # Prefer tauri output dirs first (target-qualified and native host layout).
  candidate="$(find_latest_matching_dmg "${bundle_dmg_dir_target}" || true)"
  if [[ -n "${candidate}" ]]; then
    printf '%s\n' "${candidate}"
    return 0
  fi

  candidate="$(find_latest_matching_dmg "${bundle_dmg_dir_native}" || true)"
  if [[ -n "${candidate}" ]]; then
    printf '%s\n' "${candidate}"
    return 0
  fi

  candidate="$(find_latest_matching_dmg "${scripts_dir}" || true)"
  if [[ -n "${candidate}" ]]; then
    printf '%s\n' "${candidate}"
    return 0
  fi

  die "No CoworkAny*.dmg found in ${bundle_dmg_dir_target}, ${bundle_dmg_dir_native}, or ${scripts_dir}. Run build first or pass --source-dmg."
}

create_install_command() {
  local file_path="$1"
  local dmg_name="$2"
  cat > "${file_path}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
chmod +x "\${DIR}/${INSTALL_SCRIPT_NAME}" >/dev/null 2>&1 || true
exec "\${DIR}/${INSTALL_SCRIPT_NAME}" "\${DIR}/${dmg_name}"
EOF
  chmod +x "${file_path}"
}

create_readme() {
  local file_path="$1"
  local dmg_name="$2"
  cat > "${file_path}" <<EOF
CoworkAny One-Click Installer Bundle
====================================

1) Unzip this package.
2) Double-click "install.command".
3) Follow macOS prompts if shown.

Included files:
- ${dmg_name}
- ${INSTALL_SCRIPT_NAME}
- install.command

Notes:
- This build may be unsigned/not notarized. On a fresh Mac, Gatekeeper may require manual approval once.
- install.command runs the installer script with the bundled DMG automatically.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || die "--target requires a value"
      TARGET="$2"
      shift 2
      ;;
    --out-dir)
      [[ $# -ge 2 ]] || die "--out-dir requires a value"
      OUT_DIR="$2"
      shift 2
      ;;
    --source-dmg)
      [[ $# -ge 2 ]] || die "--source-dmg requires a value"
      SOURCE_DMG="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD="1"
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

require_commands

if [[ -z "${TARGET}" ]]; then
  TARGET="$(default_target_from_host)"
fi

if [[ "${SKIP_BUILD}" != "1" ]]; then
  log "Building Tauri bundle for target: ${TARGET}"
  (
    cd "${DESKTOP_DIR}"
    npm run tauri -- build --target "${TARGET}"
  )
else
  log "Skipping build (--skip-build)."
fi

SOURCE_DMG="$(resolve_source_dmg)"
INSTALL_SCRIPT_PATH="${SCRIPT_DIR}/${INSTALL_SCRIPT_NAME}"
[[ -f "${INSTALL_SCRIPT_PATH}" ]] || die "Installer script not found: ${INSTALL_SCRIPT_PATH}"

mkdir -p "${OUT_DIR}"
TMP_ROOT="$(mktemp -d "/tmp/coworkany-one-click.XXXXXX")"

DMG_BASENAME="$(basename "${SOURCE_DMG}")"
DMG_STEM="${DMG_BASENAME%.dmg}"
PACKAGE_DIR_NAME="${DMG_STEM}_one_click_installer"
PACKAGE_DIR="${TMP_ROOT}/${PACKAGE_DIR_NAME}"
ZIP_PATH="${OUT_DIR}/${PACKAGE_DIR_NAME}.zip"

mkdir -p "${PACKAGE_DIR}"
cp "${SOURCE_DMG}" "${PACKAGE_DIR}/${DMG_BASENAME}"
cp "${INSTALL_SCRIPT_PATH}" "${PACKAGE_DIR}/${INSTALL_SCRIPT_NAME}"
chmod +x "${PACKAGE_DIR}/${INSTALL_SCRIPT_NAME}"

create_install_command "${PACKAGE_DIR}/install.command" "${DMG_BASENAME}"
create_readme "${PACKAGE_DIR}/README.txt" "${DMG_BASENAME}"

(
  cd "${TMP_ROOT}"
  rm -f "${ZIP_PATH}"
  COPYFILE_DISABLE=1 zip -qryX "${ZIP_PATH}" "${PACKAGE_DIR_NAME}"
)

ZIP_SHA256="$(shasum -a 256 "${ZIP_PATH}" | awk '{print $1}')"
DMG_SHA256="$(shasum -a 256 "${SOURCE_DMG}" | awk '{print $1}')"

log "Done."
log "Source DMG: ${SOURCE_DMG}"
log "Output ZIP: ${ZIP_PATH}"
log "DMG SHA256: ${DMG_SHA256}"
log "ZIP SHA256: ${ZIP_SHA256}"
