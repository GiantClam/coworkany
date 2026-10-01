"""Compatibility entry point; export the approved artwork using the shared pipeline."""
from pathlib import Path
import subprocess

if __name__ == "__main__":
    subprocess.run(
        ["node", str(Path(__file__).resolve().with_name("generate-brand-assets.mjs"))],
        check=True,
    )
