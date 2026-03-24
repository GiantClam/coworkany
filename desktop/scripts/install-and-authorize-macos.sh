#!/usr/bin/env bash
set -euo pipefail

APP_NAME="CoworkAny.app"
APP_BUNDLE_ID="com.coworkany.desktop"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEST_APP="/Applications/${APP_NAME}"

SOURCE_SPEC=""
SKIP_SETTINGS="0"
NO_LAUNCH="0"
EXPECTED_SHA256=""

TMP_ROOT=""
MOUNT_POINT=""
RESOLVED_APP_PATH=""

log() { printf '[install] %s\n' "$*"; }
warn() { printf '[warn] %s\n' "$*" >&2; }
die() { printf '[error] %s\n' "$*" >&2; exit 1; }

cleanup() {
    if [[ -n "${MOUNT_POINT}" ]]; then
        hdiutil detach "${MOUNT_POINT}" -quiet >/dev/null 2>&1 || hdiutil detach "${MOUNT_POINT}" -force >/dev/null 2>&1 || true
    fi
    if [[ -n "${TMP_ROOT}" && -d "${TMP_ROOT}" ]]; then
        rm -rf "${TMP_ROOT}"
    fi
}
trap cleanup EXIT

print_usage() {
    cat <<'EOF'
Usage:
  install-and-authorize-macos.sh [SOURCE] [--skip-settings] [--no-launch] [--sha256 HEX]

SOURCE can be:
  - .app directory
  - .dmg file
  - .zip file containing .app
  - HTTPS URL to .dmg/.zip/.app archive

If SOURCE is omitted:
  - first prefer artifacts in script directory (highest priority):
    CoworkAny*.dmg, CoworkAny*.app, CoworkAny*.zip
  - then auto-detect newest artifact matching:
    CoworkAny*.app, CoworkAny*.dmg, CoworkAny*.zip
  - scanned locations:
    current working directory, script directory, and desktop/src-tauri/target/**/release/bundle/*

Examples:
  ./desktop/scripts/install-and-authorize-macos.sh
  ./desktop/scripts/install-and-authorize-macos.sh "/tmp/CoworkAny.app"
  ./desktop/scripts/install-and-authorize-macos.sh "/tmp/CoworkAny_0.1.0-beta.1_aarch64.dmg"
  ./desktop/scripts/install-and-authorize-macos.sh "https://example.com/CoworkAny.dmg" --sha256 <HEX>
  ./desktop/scripts/install-and-authorize-macos.sh --skip-settings
EOF
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

require_commands() {
    local missing=()
    for cmd in ditto open xattr hdiutil find awk file; do
        if ! command_exists "$cmd"; then
            missing+=("$cmd")
        fi
    done
    if [[ "${#missing[@]}" -gt 0 ]]; then
        die "Missing required command(s): ${missing[*]}"
    fi
}

is_url() {
    [[ "$1" =~ ^https?:// ]]
}

ensure_tmp_root() {
    if [[ -z "${TMP_ROOT}" ]]; then
        TMP_ROOT="$(mktemp -d "/tmp/coworkany-install.XXXXXX")"
    fi
}

verify_sha256_if_needed() {
    local file_path="$1"
    if [[ -z "${EXPECTED_SHA256}" ]]; then
        return 0
    fi
    if ! command_exists shasum; then
        die "--sha256 was provided but 'shasum' is not available"
    fi
    local actual
    actual="$(shasum -a 256 "${file_path}" | awk '{print tolower($1)}')"
    local expected
    expected="$(printf '%s' "${EXPECTED_SHA256}" | tr '[:upper:]' '[:lower:]')"
    if [[ "${actual}" != "${expected}" ]]; then
        die "SHA256 mismatch for ${file_path}: expected=${expected}, actual=${actual}"
    fi
    log "SHA256 verified."
}

download_source_if_url() {
    local source="$1"
    if ! is_url "${source}"; then
        printf '%s\n' "${source}"
        return 0
    fi

    if ! command_exists curl; then
        die "Cannot download URL source because 'curl' is not available"
    fi

    ensure_tmp_root
    local filename
    filename="$(basename "${source%%\?*}")"
    if [[ -z "${filename}" || "${filename}" == "/" ]]; then
        filename="CoworkAny.download"
    fi
    local target="${TMP_ROOT}/${filename}"

    log "Downloading package: ${source}"
    curl --fail --location --retry 3 --connect-timeout 20 --output "${target}" "${source}"
    printf '%s\n' "${target}"
}

find_app_in_dir() {
    local search_root="$1"
    find "${search_root}" -maxdepth 4 -type d -name "*.app" | head -n 1
}

file_mtime_seconds() {
    local path="$1"
    if stat -f %m "${path}" >/dev/null 2>&1; then
        stat -f %m "${path}"
    else
        stat -c %Y "${path}"
    fi
}

choose_latest_candidate_from_roots() {
    local type_kind="$1"
    shift
    local -a roots=("$@")
    local best_path=""
    local best_mtime="-1"
    local root=""
    local max_depth=""
    local candidate=""
    local candidate_mtime=""

    for root in "${roots[@]}"; do
        case "${root}" in
            "${DESKTOP_DIR}/src-tauri/target")
                max_depth="8"
                ;;
            *)
                max_depth="3"
                ;;
        esac

        [[ -d "${root}" ]] || continue

        case "${type_kind}" in
            app)
                while IFS= read -r candidate; do
                    [[ -n "${candidate}" ]] || continue
                    candidate_mtime="$(file_mtime_seconds "${candidate}" || echo 0)"
                    if [[ "${candidate_mtime}" -gt "${best_mtime}" ]]; then
                        best_mtime="${candidate_mtime}"
                        best_path="${candidate}"
                    fi
                done < <(find "${root}" -maxdepth "${max_depth}" -type d -name "CoworkAny*.app" 2>/dev/null)
                ;;
            dmg)
                while IFS= read -r candidate; do
                    [[ -n "${candidate}" ]] || continue
                    candidate_mtime="$(file_mtime_seconds "${candidate}" || echo 0)"
                    if [[ "${candidate_mtime}" -gt "${best_mtime}" ]]; then
                        best_mtime="${candidate_mtime}"
                        best_path="${candidate}"
                    fi
                done < <(find "${root}" -maxdepth "${max_depth}" -type f -name "CoworkAny*.dmg" 2>/dev/null)
                ;;
            zip)
                while IFS= read -r candidate; do
                    [[ -n "${candidate}" ]] || continue
                    candidate_mtime="$(file_mtime_seconds "${candidate}" || echo 0)"
                    if [[ "${candidate_mtime}" -gt "${best_mtime}" ]]; then
                        best_mtime="${candidate_mtime}"
                        best_path="${candidate}"
                    fi
                done < <(find "${root}" -maxdepth "${max_depth}" -type f -name "CoworkAny*.zip" 2>/dev/null)
                ;;
        esac
    done

    if [[ -n "${best_path}" ]]; then
        printf '%s\n' "${best_path}"
        return 0
    fi

    return 1
}

choose_default_source() {
    local -a script_root=("${SCRIPT_DIR}")
    local -a fallback_roots=("${PWD}" "${DESKTOP_DIR}/src-tauri/target")
    local candidate=""

    # Highest priority: script directory with strict order requested by product.
    candidate="$(choose_latest_candidate_from_roots "dmg" "${script_root[@]}" || true)"
    if [[ -n "${candidate}" ]]; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    candidate="$(choose_latest_candidate_from_roots "app" "${script_root[@]}" || true)"
    if [[ -n "${candidate}" ]]; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    candidate="$(choose_latest_candidate_from_roots "zip" "${script_root[@]}" || true)"
    if [[ -n "${candidate}" ]]; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    # Fallback to other common artifact locations.
    candidate="$(choose_latest_candidate_from_roots "app" "${fallback_roots[@]}" || true)"
    if [[ -n "${candidate}" ]]; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    candidate="$(choose_latest_candidate_from_roots "dmg" "${fallback_roots[@]}" || true)"
    if [[ -n "${candidate}" ]]; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    candidate="$(choose_latest_candidate_from_roots "zip" "${fallback_roots[@]}" || true)"
    if [[ -n "${candidate}" ]]; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    return 1
}

mount_dmg_and_locate_app() {
    local dmg_path="$1"
    local attach_output
    attach_output="$(hdiutil attach "${dmg_path}" -nobrowse -readonly)"
    MOUNT_POINT="$(printf '%s\n' "${attach_output}" | awk -F'\t' '/\/Volumes\// {print $NF}' | tail -n 1)"
    if [[ -z "${MOUNT_POINT}" || ! -d "${MOUNT_POINT}" ]]; then
        die "Failed to mount DMG: ${dmg_path}"
    fi
    local app_path
    app_path="$(find_app_in_dir "${MOUNT_POINT}")"
    if [[ -z "${app_path}" ]]; then
        die "No .app found inside DMG mount: ${MOUNT_POINT}"
    fi
    printf '%s\n' "${app_path}"
}

extract_zip_and_locate_app() {
    local zip_path="$1"
    ensure_tmp_root
    local unzip_dir="${TMP_ROOT}/zip"
    mkdir -p "${unzip_dir}"
    ditto -x -k "${zip_path}" "${unzip_dir}"
    local app_path
    app_path="$(find_app_in_dir "${unzip_dir}")"
    if [[ -z "${app_path}" ]]; then
        die "No .app found after extracting ZIP: ${zip_path}"
    fi
    printf '%s\n' "${app_path}"
}

resolve_source_to_app() {
    local source="$1"
    if [[ -d "${source}" && "${source}" == *.app ]]; then
        printf '%s\n' "${source}"
        return 0
    fi

    if [[ -d "${source}" ]]; then
        local app_in_dir
        app_in_dir="$(find_app_in_dir "${source}")"
        if [[ -n "${app_in_dir}" ]]; then
            printf '%s\n' "${app_in_dir}"
            return 0
        fi
        die "Directory does not contain .app: ${source}"
    fi

    if [[ ! -f "${source}" ]]; then
        die "Source not found: ${source}"
    fi

    local lower
    lower="$(printf '%s' "${source}" | tr '[:upper:]' '[:lower:]')"
    case "${lower}" in
        *.dmg)
            mount_dmg_and_locate_app "${source}"
            ;;
        *.zip)
            extract_zip_and_locate_app "${source}"
            ;;
        *)
            die "Unsupported source type: ${source}. Please pass .app/.dmg/.zip or HTTPS URL."
            ;;
    esac
}

check_arch_compatibility() {
    local app_path="$1"
    local bin_path="${app_path}/Contents/MacOS/coworkany-desktop"
    if [[ ! -f "${bin_path}" ]]; then
        warn "Cannot find main binary at ${bin_path}; skipping architecture check."
        return 0
    fi

    local host_arch
    host_arch="$(uname -m)"
    local file_info
    file_info="$(file "${bin_path}")"

    if [[ "${host_arch}" == "x86_64" && "${file_info}" == *"arm64"* && "${file_info}" != *"x86_64"* ]]; then
        die "This build is Apple Silicon only (arm64), but this Mac is Intel (x86_64)."
    fi
}

stop_running_processes() {
    log "Stopping running CoworkAny processes..."
    pkill -f "/Applications/CoworkAny.app/Contents/MacOS/coworkany-desktop" >/dev/null 2>&1 || true
    pkill -f "/Applications/CoworkAny.app/Contents/Resources/sidecar/coworkany-sidecar" >/dev/null 2>&1 || true
    sleep 1
}

install_app_bundle() {
    local source_app="$1"
    log "Installing ${APP_NAME} to ${DEST_APP}..."
    if [[ -w "/Applications" ]]; then
        rm -rf "${DEST_APP}" || true
        ditto "${source_app}" "${DEST_APP}"
        xattr -dr com.apple.quarantine "${DEST_APP}" >/dev/null 2>&1 || true
    else
        log "Requesting administrator privileges for /Applications..."
        sudo rm -rf "${DEST_APP}" || true
        sudo ditto "${source_app}" "${DEST_APP}"
        sudo xattr -dr com.apple.quarantine "${DEST_APP}" >/dev/null 2>&1 || true
    fi
}

open_privacy_pages() {
    if [[ "${SKIP_SETTINGS}" == "1" ]]; then
        log "Skipped opening settings pages (--skip-settings)."
        return 0
    fi
    # macOS TCC cannot be auto-granted by shell script; open target pages for manual approval.
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone" || true
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" || true
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation" || true
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" || true
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            print_usage
            exit 0
            ;;
        --skip-settings)
            SKIP_SETTINGS="1"
            shift
            ;;
        --no-launch)
            NO_LAUNCH="1"
            shift
            ;;
        --sha256)
            [[ $# -ge 2 ]] || die "--sha256 requires a value"
            EXPECTED_SHA256="$2"
            shift 2
            ;;
        --source)
            [[ $# -ge 2 ]] || die "--source requires a value"
            SOURCE_SPEC="$2"
            shift 2
            ;;
        *)
            if [[ -z "${SOURCE_SPEC}" ]]; then
                SOURCE_SPEC="$1"
                shift
            else
                die "Unknown argument: $1"
            fi
            ;;
    esac
done

require_commands

if [[ -z "${SOURCE_SPEC}" ]]; then
    log "No source specified. Searching common artifact locations..."
    if SOURCE_SPEC="$(choose_default_source)"; then
        log "No source specified. Using detected artifact: ${SOURCE_SPEC}"
    else
        die "No source specified and no matching artifacts found. Searched: ${PWD}, ${SCRIPT_DIR}, ${DESKTOP_DIR}/src-tauri/target (patterns: CoworkAny*.app, CoworkAny*.dmg, CoworkAny*.zip)"
    fi
fi

SOURCE_SPEC="$(download_source_if_url "${SOURCE_SPEC}")"
if [[ -n "${EXPECTED_SHA256}" ]]; then
    if [[ -f "${SOURCE_SPEC}" ]]; then
        verify_sha256_if_needed "${SOURCE_SPEC}"
    elif [[ ! -f "${SOURCE_SPEC}" ]]; then
        warn "--sha256 provided, but source is not a regular file after resolution: ${SOURCE_SPEC}"
    fi
fi

RESOLVED_APP_PATH="$(resolve_source_to_app "${SOURCE_SPEC}")"
[[ -d "${RESOLVED_APP_PATH}" ]] || die "Resolved app path invalid: ${RESOLVED_APP_PATH}"
check_arch_compatibility "${RESOLVED_APP_PATH}"

stop_running_processes
install_app_bundle "${RESOLVED_APP_PATH}"

if [[ "${NO_LAUNCH}" == "0" ]]; then
    log "Launching ${APP_NAME}..."
    open -a "${DEST_APP}"
    sleep 2
else
    log "Skipped app launch (--no-launch)."
fi

open_privacy_pages

cat <<EOF

Done.

Installed:
  ${DEST_APP}

Manual authorization checklist (required by macOS):
  - Microphone: allow ${APP_NAME}
  - Accessibility: allow ${APP_NAME}
  - Automation: allow ${APP_NAME} to control Terminal/Chrome when prompted
  - Full Disk Access (optional but recommended): allow ${APP_NAME}

Bundle identifier:
  ${APP_BUNDLE_ID}
EOF
