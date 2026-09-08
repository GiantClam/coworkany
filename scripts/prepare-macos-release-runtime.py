"""Fetch an approved, relocatable runtime archive; never package host installations."""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import urllib.request


def prepare(url, expected_hash, destination):
    if not url.startswith("https://") or not re.fullmatch(r"[a-fA-F0-9]{64}", expected_hash):
        raise ValueError("macos_runtime_https_url_and_sha256_required")
    destination = Path(destination)
    if destination.exists():
        raise ValueError("macos_runtime_destination_must_not_exist")
    with tempfile.TemporaryDirectory(prefix="coworkany-runtime-") as temporary:
        archive = Path(temporary) / "runtime.tar.gz"
        digest = hashlib.sha256()
        with urllib.request.urlopen(url, timeout=120) as response, archive.open("wb") as output:
            if not response.url.startswith("https://"):
                raise ValueError("macos_runtime_insecure_redirect")
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != expected_hash.lower():
            raise ValueError("macos_runtime_checksum_mismatch")
        with tarfile.open(archive, "r:gz") as bundle:
            bundle.extractall(destination, filter="data")
    required = {
        "COWORKANY_MAC_NODE_RUNTIME_DIR": "node",
        "COWORKANY_MAC_OPENCODE_RUNTIME_DIR": "opencode",
        "COWORKANY_MAC_PYTHON_RUNTIME_DIR": "python",
        "COWORKANY_MAC_FONT_PATH": "fonts/NotoSansCJKsc-Regular.otf",
    }
    for relative in ["node/node", "opencode/opencode", "python/python3", "fonts/NotoSansCJKsc-Regular.otf", "LICENSES.txt"]:
        path = destination / relative
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"macos_runtime_file_missing:{relative}")
    for relative in ["node/node", "opencode/opencode", "python/python3"]:
        binary = destination / relative
        subprocess.run(["lipo", "-verify_arch", "arm64", str(binary)], check=True)
        subprocess.run([str(binary), "--version"], check=True, timeout=60,
                       env={**os.environ, "OPENCODE_DISABLE_MODELS_FETCH": "true", "OPENCODE_DISABLE_AUTOUPDATE": "true"})
    return {key: str((destination / relative).resolve()) for key, relative in required.items()}


if __name__ == "__main__":
    target = Path(os.environ["RUNNER_TEMP"]) / "coworkany-macos-runtime"
    values = prepare(os.environ["COWORKANY_MAC_RUNTIME_URL"], os.environ["COWORKANY_MAC_RUNTIME_SHA256"], target)
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as output:
        for key, value in values.items():
            if "\n" in value or "\r" in value:
                raise ValueError("macos_runtime_path_contains_newline")
            output.write(f"{key}={value}\n")
        output.write(f"COWORKANY_MAC_RUNTIME_LICENSES_PATH={target / 'LICENSES.txt'}\n")
