"""
Author: Judy
Created: 2026-09-18
Function:
    将已验证的 macOS 桌面 Runtime 打包为可供 GitHub Actions 下载的归档。
    归档包含 Node、OpenCode、Python、字体和媒体工具，并汇总上游许可。
Example:
    python3 scripts/20260918Codex_package_intel_macos_runtime.py \
      --runtime-dir /path/to/runtime --node-license /path/to/node/LICENSE \
      --opencode-license /path/to/opencode/LICENSE --ffmpeg-license /path/to/COPYING.LGPLv2.1 \
      --font-license /path/to/OFL.txt --output /path/to/coworkany-runtime-macos-x64.tar.gz
"""
import argparse
import gzip
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile


REQUIRED_FILES = (
    "node/node",
    "opencode/opencode",
    "python/python3",
    "media/ffmpeg",
    "media/ffprobe",
    "fonts/NotoSansCJKsc-Regular.otf",
)


def read_license(title, path):
    """读取真实上游许可证，避免在发布包中伪造许可内容。"""
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        raise ValueError(f"license_empty:{path}")
    return f"\n\n{'=' * 72}\n{title}\n来源：{path.name}\n{'=' * 72}\n{text.rstrip()}\n"


def normalized_tar_info(info):
    """固定元数据，使同一输入产生相同归档。"""
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mtime = 0
    return info


def verify_runtime(runtime_dir, architecture):
    """确认 Runtime 与目标应用架构一致。"""
    for relative in REQUIRED_FILES:
        path = runtime_dir / relative
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"runtime_file_missing:{relative}")
    for relative in ("node/node", "opencode/opencode", "python/python3", "media/ffmpeg", "media/ffprobe"):
        subprocess.run(["lipo", str(runtime_dir / relative), "-verify_arch", architecture], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--architecture", choices=("arm64", "x86_64"), default="x86_64")
    parser.add_argument("--node-license", type=Path, required=True)
    parser.add_argument("--opencode-license", type=Path, required=True)
    parser.add_argument("--ffmpeg-license", type=Path, required=True)
    parser.add_argument("--font-license", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    runtime_dir = args.runtime_dir.resolve()
    if not runtime_dir.is_dir():
        raise ValueError(f"runtime_directory_missing:{runtime_dir}")
    if args.output.exists():
        raise ValueError(f"output_already_exists:{args.output}")
    verify_runtime(runtime_dir, args.architecture)

    licenses = "CoworkAny macOS Runtime 的第三方许可证\n"
    licenses += "Runtime 内各依赖自己的 LICENSE、NOTICE 文件也会原样保留。\n"
    licenses += read_license("Node.js", args.node_license.resolve())
    licenses += read_license("OpenCode", args.opencode_license.resolve())
    licenses += read_license("FFmpeg（LGPL 2.1 或更高版本）", args.ffmpeg_license.resolve())
    licenses += read_license("Noto Sans CJK SC", args.font_license.resolve())
    license_bytes = licenses.encode("utf-8")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for child in sorted(runtime_dir.iterdir(), key=lambda item: item.name):
                archive.add(child, arcname=child.name, recursive=True, filter=normalized_tar_info)
            info = tarfile.TarInfo("LICENSES.txt")
            info.size = len(license_bytes)
            info.mode = 0o644
            archive.addfile(normalized_tar_info(info), fileobj=io.BytesIO(license_bytes))

    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    print(f"archive={args.output.resolve()}")
    print(f"sha256={digest}")


if __name__ == "__main__":
    main()
