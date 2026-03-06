import os
import subprocess
import sys
from pathlib import Path


def ensure_dependencies() -> None:
    try:
        import PIL  # noqa: F401
        import imagehash  # noqa: F401
        return
    except Exception:
        pass

    print("Installing required packages: Pillow imagehash")
    proc = subprocess.run(
        [sys.executable, "-m", "pip", "install", "Pillow", "imagehash"],
        capture_output=True,
        text=True,
    )
    if proc.stdout:
        print(proc.stdout.strip())
    if proc.stderr:
        print(proc.stderr.strip())
    if proc.returncode != 0:
        raise RuntimeError("Failed to install Pillow/imagehash")


def collect_images(folder: Path) -> list[Path]:
    exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    return sorted([p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in exts])


def group_similar(images: list[Path], threshold: int) -> list[list[Path]]:
    from PIL import Image, ImageFile
    import imagehash

    ImageFile.LOAD_TRUNCATED_IMAGES = True

    hashes: dict[Path, imagehash.ImageHash] = {}
    for image_path in images:
        try:
            with Image.open(image_path) as img:
                hashes[image_path] = imagehash.phash(img)
            print(f"OK hashed: {image_path.name}")
        except Exception as exc:
            print(f"ERR hash {image_path.name}: {exc}")

    groups: list[list[Path]] = []
    visited: set[Path] = set()
    keys = list(hashes.keys())
    for i, p1 in enumerate(keys):
        if p1 in visited:
            continue
        h1 = hashes[p1]
        group = [p1]
        for p2 in keys[i + 1 :]:
            if p2 in visited:
                continue
            if (h1 - hashes[p2]) <= threshold:
                group.append(p2)
                visited.add(p2)
        visited.add(p1)
        if len(group) > 1:
            groups.append(group)
    return groups


def remove_duplicates(groups: list[list[Path]]) -> list[Path]:
    removed: list[Path] = []
    for group in groups:
        keep = group[0]
        print(f"GROUP keep={keep.name} total={len(group)}")
        for dup in group[1:]:
            try:
                dup.unlink()
                removed.append(dup)
                print(f"REMOVED {dup.name}")
            except Exception as exc:
                print(f"ERR remove {dup.name}: {exc}")
    return removed


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python remove_similar_images.py <folder_path> [--delete] [--threshold N]")
        return 1

    folder = Path(sys.argv[1]).expanduser().resolve()
    do_delete = "--delete" in sys.argv

    threshold = 5
    if "--threshold" in sys.argv:
        idx = sys.argv.index("--threshold")
        if idx + 1 < len(sys.argv):
            threshold = int(sys.argv[idx + 1])

    if not folder.exists() or not folder.is_dir():
        print(f"ERR folder not found: {folder}")
        return 1

    ensure_dependencies()
    images = collect_images(folder)
    print(f"IMAGES_FOUND={len(images)}")
    if not images:
        return 0

    groups = group_similar(images, threshold)
    print(f"SIMILAR_GROUPS={len(groups)}")

    if not groups:
        print("DEDUPE_DONE removed=0 remaining=" + str(len(images)))
        return 0

    if do_delete:
        removed = remove_duplicates(groups)
        remaining = len(collect_images(folder))
        print(f"DEDUPE_DONE removed={len(removed)} remaining={remaining}")
    else:
        total_to_remove = sum(max(0, len(g) - 1) for g in groups)
        print(f"PREVIEW_ONLY to_remove={total_to_remove}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
