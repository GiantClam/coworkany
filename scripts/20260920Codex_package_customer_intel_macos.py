"""
Author: Judy
Created: 2026-09-20
Function:
    Build an Intel macOS portable customer package with the complete customer
    Provider configuration and selected CoworkAny workflow.
Example:
    python3 scripts/20260920Codex_package_customer_intel_macos.py \
      --source .artifacts/desktop-release-intel/CoworkAny-macOS-x64-internal-portable \
      --config "$HOME/Library/Application Support/CoworkAny/config.json" \
      --workflow /Users/edy/Downloads/coworkany-workflow-1789723297937.json \
      --output .artifacts/customer-custom-intel-v0.1.18
"""
import argparse
import hashlib
import json
import shutil
import sqlite3
import subprocess
from pathlib import Path


OUTPUT_DATA_DIRECTORY = "CoworkAny Data"
WORKFLOW_ID = "customer-workflow-character-subtitle-video"
WORKFLOW_NAME = "人物替换字幕视频"


def load_customer_workflow(value: dict) -> dict:
    workflow = value.get("definition", value)
    if not isinstance(workflow, dict) or not isinstance(workflow.get("nodes"), list) or not isinstance(workflow.get("edges"), list):
        raise ValueError("customer_workflow_invalid")
    return json.loads(json.dumps(workflow, ensure_ascii=False))


def save_customer_workflow(connection: sqlite3.Connection, workflow: dict) -> None:
    definition_json = json.dumps(workflow, ensure_ascii=False, separators=(",", ":"))
    revision_hash = hashlib.sha256(definition_json.encode("utf-8")).hexdigest()
    connection.execute(
        "INSERT INTO workflows(id, project_id, name, definition_json) VALUES (?, NULL, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, name=excluded.name, "
        "definition_json=excluded.definition_json, updated_at=CURRENT_TIMESTAMP",
        (WORKFLOW_ID, WORKFLOW_NAME, definition_json),
    )
    revision = connection.execute(
        "SELECT COALESCE(MAX(revision), 0) + 1 FROM workflow_revisions WHERE workflow_id=?",
        (WORKFLOW_ID,),
    ).fetchone()[0]
    connection.execute(
        "INSERT INTO workflow_revisions(id, workflow_id, revision, definition_json, definition_hash) VALUES (?, ?, ?, ?, ?)",
        (f"{WORKFLOW_ID}:revision:{revision}", WORKFLOW_ID, revision, definition_json, revision_hash),
    )


def seed_database(source_database: Path, destination_database: Path, workflow: dict) -> None:
    source = sqlite3.connect(source_database)
    destination = sqlite3.connect(destination_database)
    try:
        source.backup(destination)
        destination.execute("PRAGMA foreign_keys = ON")
        for table in [
            "run_attempts", "run_checkpoints", "run_nodes", "run_events", "usage_records", "artifacts",
            "messages", "runs", "workflow_revisions", "workflows", "conversations", "vault_mappings",
            "projects", "identity",
        ]:
            destination.execute(f"DELETE FROM {table}")
        save_customer_workflow(destination, workflow)
        destination.commit()
        if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("customer_database_integrity_failed")
    finally:
        destination.close()
        source.close()


def import_workbench_workflow(database: Path, workflow: dict) -> None:
    if not database.is_file():
        raise ValueError(f"workbench_database_missing:{database}")
    connection = sqlite3.connect(database)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        save_customer_workflow(connection, workflow)
        connection.commit()
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("workbench_database_integrity_failed")
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def write_readme(root: Path) -> None:
    (root / "README-CUSTOMER.md").write_text(
        "# CoworkAny 客户定制包\n\n"
        "本包为 Intel Mac 便携版，已包含完整 Provider 配置和“人物替换字幕视频”工作流。\n\n"
        "## 首次使用\n\n"
        "1. 打开 `CoworkAny.app`，包内已预置客户定制的 Provider、密钥和 RunningHub 工作流编号。\n"
        "2. 打开“工作流”，确认三个上传节点的本地文件可用后运行；若文件未随包提供，再重新选择对应文件。\n\n"
        "本包包含客户定制的 Provider 配置、密钥、RunningHub 工作流编号和工作流定义，请妥善保管，不要按 Release 包方式清理。\n"
        "便携运行所需的工作区路径和运行时路径会在打包时改为当前包目录。\n",
        encoding="utf-8",
    )


def write_workflow_file(root: Path, workflow: dict) -> None:
    workflow_directory = root / "workflows"
    workflow_directory.mkdir()
    (workflow_directory / f"{WORKFLOW_ID}.json").write_text(
        json.dumps(
            {"format": "coworkany-workflow", "exportedAt": "customer-package", "definition": workflow},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--workflow", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workbench-db", type=Path)
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    archive = output.parent / f"{output.name}.zip"
    checksum = output.parent / f"{output.name}.zip.sha256"
    source_database = source / OUTPUT_DATA_DIRECTORY / "app.db"
    if not (source / "CoworkAny.app").is_dir() or not (source / "portable.flag").is_file():
        raise ValueError(f"customer_source_portable_package_invalid:{source}")
    if not source_database.is_file():
        raise ValueError(f"customer_source_database_missing:{source_database}")
    if output.exists() or archive.exists():
        raise ValueError(f"customer_output_already_exists:{output}")

    configuration = json.loads(args.config.read_text(encoding="utf-8"))
    if not isinstance(configuration, dict):
        raise ValueError("customer_config_invalid")
    workflow = load_customer_workflow(json.loads(args.workflow.read_text(encoding="utf-8")))
    if args.workbench_db:
        import_workbench_workflow(args.workbench_db.resolve(), workflow)

    shutil.copytree(source, output, ignore=shutil.ignore_patterns(OUTPUT_DATA_DIRECTORY, "*.instance.lock"))
    if not output.name or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for character in output.name):
        raise ValueError(f"customer_package_name_invalid:{output.name}")
    customer_marker = output / "CoworkAny.app" / "Contents" / "Resources" / "customer-package.flag"
    customer_marker.write_text(f"{output.name}\n", encoding="utf-8")
    data = output / OUTPUT_DATA_DIRECTORY
    data.mkdir()
    configuration["workspacePath"] = str((data / "projects").resolve())
    configuration["runtime"] = {"source": "system"}
    configuration["packageType"] = "customer"
    (data / "config.json").write_text(json.dumps(configuration, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    seed_database(source_database, data / "app.db", workflow)
    for sidecar in (data / "app.db-wal", data / "app.db-shm"):
        sidecar.unlink(missing_ok=True)
    seed = output / "CoworkAny.app" / "Contents" / "Resources" / "customer-package-seed"
    seed.mkdir()
    shutil.copy2(data / "config.json", seed / "config.json")
    shutil.copy2(data / "app.db", seed / "app.db")
    subprocess.run(["/usr/bin/codesign", "--force", "--deep", "--sign", "-", str(output / "CoworkAny.app")], check=True)
    write_workflow_file(output, workflow)
    write_readme(output)

    subprocess.run(["/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(output), str(archive)], check=True)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum.write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
    print(json.dumps({"status": "created", "package": str(archive), "sha256": digest, "workflow": WORKFLOW_NAME}, ensure_ascii=False))


if __name__ == "__main__":
    main()
