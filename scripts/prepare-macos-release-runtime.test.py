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


class RuntimeArchiveTests(unittest.TestCase):
    def test_rejects_wrong_digest_before_extracting_or_running(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "output"
            with patch.object(runtime.urllib.request, "urlopen", return_value=Response(b"untrusted")), patch.object(runtime.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "checksum_mismatch"):
                    runtime.prepare("https://example.com/runtime.tar.gz", "0" * 64, target)
                run.assert_not_called()
                self.assertFalse(target.exists())

    def test_rejects_archive_escape_and_missing_components(self):
        for names in [["../escaped"], ["node/node"]]:
            with self.subTest(names=names), tempfile.TemporaryDirectory() as root:
                data = archive_bytes(names)
                with patch.object(runtime.urllib.request, "urlopen", return_value=Response(data)), patch.object(runtime.subprocess, "run") as run:
                    with self.assertRaises((ValueError, tarfile.FilterError)):
                        runtime.prepare("https://example.com/runtime.tar.gz", hashlib.sha256(data).hexdigest(), Path(root) / "output")
                    run.assert_not_called()
                    self.assertFalse((Path(root) / "escaped").exists())

    def test_complete_archive_exports_paths_and_checks_binaries(self):
        names = ["node/node", "opencode/opencode", "python/python3", "fonts/NotoSansCJKsc-Regular.otf", "LICENSES.txt"]
        data = archive_bytes(names)
        with tempfile.TemporaryDirectory() as root, patch.object(runtime.urllib.request, "urlopen", return_value=Response(data)), patch.object(runtime.subprocess, "run") as run:
            values = runtime.prepare("https://example.com/runtime.tar.gz", hashlib.sha256(data).hexdigest(), Path(root) / "output")
            self.assertEqual(len(values), 4)
            self.assertEqual(run.call_count, 6)
            self.assertTrue(Path(values["COWORKANY_MAC_FONT_PATH"]).is_file())


if __name__ == "__main__":
    unittest.main()
