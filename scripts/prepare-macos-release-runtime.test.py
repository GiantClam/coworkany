import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("runtime", Path(__file__).with_name("prepare-macos-release-runtime.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class Response(io.BytesIO):
    url = "https://example.com/runtime.tar.gz"


def archive_bytes(names):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name in names:
            entry = tarfile.TarInfo(name)
            entry.size = 4
            entry.mode = 0o755
            archive.addfile(entry, io.BytesIO(b"test"))
    return buffer.getvalue()


def archive_with_symlink():
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        entry = tarfile.TarInfo("./python/python3")
        entry.type = tarfile.SYMTYPE
        entry.linkname = "bin/python3"
        archive.addfile(entry)
    return buffer.getvalue()


class RuntimeArchiveTests(unittest.TestCase):
    def test_reseals_nested_python_app_after_relocation(self):
        with tempfile.TemporaryDirectory() as root, patch.object(runtime.subprocess, "run") as run:
            python_root = Path(root) / "python"
            (python_root / "Resources/Python.app/Contents/MacOS").mkdir(parents=True)
            (python_root / "Python").write_bytes(b"python")
            (python_root / "Resources/Python.app/Contents/MacOS/Python").write_bytes(b"python")

            runtime.repair_python_relocation(Path(root))

            self.assertTrue(any(
                call.args[0] == ["codesign", "--force", "--deep", "--sign", "-", str(python_root / "Resources/Python.app")]
                for call in run.call_args_list
            ))

    def test_rejects_wrong_digest_before_extracting_or_running(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "output"
            with patch.object(runtime.urllib.request, "urlopen", return_value=Response(b"untrusted")), patch.object(runtime.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "checksum_mismatch"):
                    runtime.prepare("https://example.com/runtime.tar.gz", "0" * 64, target)
                run.assert_not_called()
                self.assertFalse(target.exists())

    def test_accepts_relative_runtime_symlink(self):
        data = archive_with_symlink()
        with tempfile.TemporaryDirectory() as root, patch.object(runtime.urllib.request, "urlopen", return_value=Response(data)), patch.object(runtime.subprocess, "run"):
            output = Path(root) / "output"
            output.mkdir()
            runtime.extract_runtime_archive(tarfile.open(fileobj=io.BytesIO(data), mode="r:gz"), output)
            self.assertEqual((output / "python/python3").readlink(), Path("bin/python3"))

    def test_rejects_archive_escape_and_missing_components(self):
        for names in [["../escaped"], ["node/node"]]:
            with self.subTest(names=names), tempfile.TemporaryDirectory() as root:
                data = archive_bytes(names)
                with patch.object(runtime.urllib.request, "urlopen", return_value=Response(data)), patch.object(runtime.subprocess, "run") as run:
                    with self.assertRaises(ValueError):
                        runtime.prepare("https://example.com/runtime.tar.gz", hashlib.sha256(data).hexdigest(), Path(root) / "output")
                    run.assert_not_called()
                    self.assertFalse((Path(root) / "escaped").exists())

    def test_complete_archive_exports_paths_and_checks_binaries(self):
        names = ["node/node", "opencode/opencode", "python/python3", "media/ffmpeg", "media/ffprobe", "fonts/NotoSansCJKsc-Regular.otf", "LICENSES.txt"]
        data = archive_bytes(names)
        with tempfile.TemporaryDirectory() as root, patch.object(runtime.urllib.request, "urlopen", return_value=Response(data)), patch.object(runtime.subprocess, "run") as run:
            values = runtime.prepare("https://example.com/runtime.tar.gz", hashlib.sha256(data).hexdigest(), Path(root) / "output")
            self.assertEqual(len(values), 6)
            self.assertEqual(run.call_count, 10)
            self.assertEqual(run.call_args_list[0].args[0][1:], [str(Path(root) / "output" / "node/node"), "-verify_arch", "arm64"])
            self.assertEqual(values["COWORKANY_MAC_STATIC_FFMPEG_PATH"], str((Path(root) / "output" / "media/ffmpeg").resolve()))
            self.assertEqual(values["COWORKANY_MAC_STATIC_FFPROBE_PATH"], str((Path(root) / "output" / "media/ffprobe").resolve()))
            self.assertTrue(Path(values["COWORKANY_MAC_FONT_PATH"]).is_file())

    def test_accepts_intel_runtime_architecture(self):
        names = ["node/node", "opencode/opencode", "python/python3", "media/ffmpeg", "media/ffprobe", "fonts/NotoSansCJKsc-Regular.otf", "LICENSES.txt"]
        data = archive_bytes(names)
        with tempfile.TemporaryDirectory() as root, patch.object(runtime.urllib.request, "urlopen", return_value=Response(data)), patch.object(runtime.subprocess, "run") as run:
            runtime.prepare("https://example.com/runtime.tar.gz", hashlib.sha256(data).hexdigest(), Path(root) / "output", "x86_64")
            self.assertEqual(run.call_args_list[0].args[0][1:], [str(Path(root) / "output" / "node/node"), "-verify_arch", "x86_64"])


if __name__ == "__main__":
    unittest.main()
