#!/usr/bin/env bash
set -euo pipefail

if [[ "${OSTYPE:-}" != darwin* ]]; then echo "macos_release_requires_darwin" >&2; exit 1; fi
required=(COWORKANY_MAC_APP_PATH APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "macos_release_env_required:${name}" >&2; exit 1; }
done

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
app_path="$(cd "$(dirname "$COWORKANY_MAC_APP_PATH")" && pwd)/$(basename "$COWORKANY_MAC_APP_PATH")"
output_dir="${COWORKANY_MAC_PORTABLE_OUTPUT:-${COWORKANY_MAC_RELEASE_OUTPUT:-$repo_root/.artifacts/desktop-release}}"
version="${COWORKANY_RELEASE_VERSION:-}"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]] || { echo "macos_release_version_invalid" >&2; exit 1; }
entitlements="$repo_root/scripts/macos-release.entitlements.plist"
[[ -d "$app_path" && "$app_path" == *.app ]] || { echo "macos_app_bundle_missing:$app_path" >&2; exit 1; }
[[ -f "$entitlements" ]] || { echo "macos_release_entitlements_missing:$entitlements" >&2; exit 1; }
for command_name in codesign security xcrun hdiutil ditto spctl mktemp base64 uuidgen file; do
  command -v "$command_name" >/dev/null || { echo "macos_release_command_missing:$command_name" >&2; exit 1; }
done

mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
keychain_password="$(uuidgen)"
work_dir="$(mktemp -d "/tmp/coworkany-release-XXXXXX")"
keychain_path="$work_dir/signing.keychain-db"
certificate_path="$work_dir/certificate.p12"
notary_zip="$work_dir/notary.zip"
original_keychains=()
while IFS= read -r keychain; do original_keychains+=("$keychain"); done < <(security list-keychains -d user | sed -E 's/^[[:space:]]*"(.*)"[[:space:]]*$/\1/')
cleanup() {
  set +e
  if [[ ${#original_keychains[@]} -gt 0 ]]; then security list-keychains -d user -s "${original_keychains[@]}" >/dev/null 2>&1; fi
  security delete-keychain "$keychain_path" >/dev/null 2>&1
  rm -rf "$work_dir" "${dmg_stage:-}"
}
trap cleanup EXIT

base64 -D <<<"$APPLE_CERTIFICATE" > "$certificate_path"
security create-keychain -p "$keychain_password" "$keychain_path" >/dev/null
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security import "$certificate_path" -k "$keychain_path" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain_path" >/dev/null
security list-keychains -d user -s "$keychain_path" "${original_keychains[@]}"

codesign_args=(--force --options runtime --timestamp --keychain "$keychain_path" --sign "$APPLE_SIGNING_IDENTITY")
runtime_codesign_args=(--entitlements "$entitlements")
while IFS= read -r candidate; do
  file_output="$(file -b "$candidate")"
  if [[ "$file_output" == *Mach-O* ]]; then
    if [[ "$file_output" == *executable* && "$candidate" != "$app_path/Contents/MacOS/"* ]]; then
      codesign "${codesign_args[@]}" "${runtime_codesign_args[@]}" "$candidate" >/dev/null
    else
      codesign "${codesign_args[@]}" "$candidate" >/dev/null
    fi
  fi
done < <(find "$app_path/Contents" -type f -print | sort -r)

while IFS= read -r bundle; do codesign "${codesign_args[@]}" "$bundle" >/dev/null; done < <(
  find "$app_path/Contents" \( -name '*.framework' -o -name '*.app' -o -name '*.xpc' \) -print |
    awk '{n=gsub(/\//,"/"); print n "\t" $0}' | sort -rn | cut -f2-
)
codesign "${codesign_args[@]}" "$app_path" >/dev/null
codesign --verify --deep --strict --verbose=2 "$app_path" >/dev/null

ditto -c -k --sequesterRsrc --keepParent "$app_path" "$notary_zip"
notary_app_result="$(xcrun notarytool submit "$notary_zip" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --output-format json --wait)"
printf '%s' "$notary_app_result" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"Accepted"' || { echo "macos_app_notarization_not_accepted" >&2; exit 1; }
xcrun stapler staple "$app_path" >/dev/null
xcrun stapler validate "$app_path" >/dev/null
spctl --assess --type execute --verbose=4 "$app_path" >/dev/null

dmg_stage="$(mktemp -d "/tmp/coworkany-dmg-XXXXXX")"
ditto "$app_path" "$dmg_stage/CoworkAny.app"
codesign --verify --deep --strict "$dmg_stage/CoworkAny.app" >/dev/null
ln -s /Applications "$dmg_stage/Applications"
dmg_path="$output_dir/CoworkAny-${version}-macOS-arm64.dmg"
rm -f "$dmg_path"
hdiutil create -volname CoworkAny -srcfolder "$dmg_stage" -ov -format UDZO "$dmg_path" >/dev/null

codesign --force --timestamp --keychain "$keychain_path" --sign "$APPLE_SIGNING_IDENTITY" "$dmg_path" >/dev/null
codesign --verify --strict --verbose=2 "$dmg_path" >/dev/null
notary_dmg_result="$(xcrun notarytool submit "$dmg_path" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --output-format json --wait)"
printf '%s' "$notary_dmg_result" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"Accepted"' || { echo "macos_dmg_notarization_not_accepted" >&2; exit 1; }
xcrun stapler staple "$dmg_path" >/dev/null
xcrun stapler validate "$dmg_path" >/dev/null

COWORKANY_MAC_APP_PATH="$app_path" COWORKANY_MAC_PORTABLE_OUTPUT="$output_dir" node "$repo_root/scripts/package-macos-portable.mjs" >/dev/null
node -e 'console.log(JSON.stringify({status:"released",dmg:process.argv[1],portableZip:process.argv[2]}))' "$dmg_path" "$output_dir/CoworkAny-macOS-arm64-portable.zip"
