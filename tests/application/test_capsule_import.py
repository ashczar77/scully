from __future__ import annotations

import hashlib
import io
import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from scully.application.capsule_import import (
    MAX_ARCHIVE_BYTES,
    CapsuleImporter,
    CapsuleImportError,
)
from scully.infrastructure.capsules import CapsuleRepository
from scully.infrastructure.database import Database


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SEED_CAPSULE = REPOSITORY_ROOT / "fixtures" / "capsules" / "proxy-identity-collapse"


class CapsuleImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.database = Database(self.root / "state" / "scully.db")
        self.database.initialize()
        self.repository = CapsuleRepository(self.database)
        self.importer = CapsuleImporter(self.root / "artifacts", self.repository)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_valid_seed_is_normalized_stored_and_idempotent(self) -> None:
        first = self.importer.import_path(SEED_CAPSULE)
        second = self.importer.import_path(SEED_CAPSULE)

        self.assertEqual(first, second)
        self.assertEqual(first.capsule_id, "proxy-identity-collapse-v2")
        self.assertEqual(len(first.evidence), 6)
        artifacts = [path for path in (self.root / "artifacts").rglob("*") if path.is_file()]
        self.assertEqual(len(artifacts), 6)
        for evidence in first.evidence:
            artifact = self.root / "artifacts" / evidence.sha256[:2] / evidence.sha256
            self.assertEqual(hashlib.sha256(artifact.read_bytes()).hexdigest(), evidence.sha256)
            self.assertEqual(artifact.stat().st_mode & 0o777, 0o600)

        loaded = self.repository.get(first.capsule_id)
        self.assertEqual(loaded, first)

    def test_valid_zip_uses_the_same_ingestion_path(self) -> None:
        summary = self.importer.import_zip_bytes(self._zip_directory(SEED_CAPSULE))

        self.assertEqual(summary.signature_id, "proxy-identity-collapse-v1")

    def test_hash_mismatch_is_rejected_before_artifact_storage(self) -> None:
        capsule = self._copy_seed()
        (capsule / "evidence" / "requests.json").write_text("{}\n", encoding="utf-8")

        with self.assert_import_error("size_mismatch"):
            self.importer.import_path(capsule)
        self.assertFalse((self.root / "artifacts").exists())

    def test_secret_is_rejected_before_artifact_storage(self) -> None:
        capsule = self._copy_seed()
        evidence_path = capsule / "evidence" / "requests.json"
        content = b'{"api_key":"test-secret-value-12345"}\n'
        evidence_path.write_bytes(content)
        self._update_evidence_metadata(capsule, "requests", content)

        with self.assert_import_error("secret_detected"):
            self.importer.import_path(capsule)
        self.assertFalse((self.root / "artifacts").exists())

    def test_secret_in_manifest_is_rejected_before_persistence(self) -> None:
        capsule = self._copy_seed()
        manifest_path = capsule / "capsule.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["observed_summary"] = "NEBIUS_API_KEY=test-secret-value-12345"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        with self.assert_import_error("secret_detected"):
            self.importer.import_path(capsule)
        self.assertIsNone(self.repository.get("proxy-identity-collapse-v2"))

    def test_undeclared_and_missing_files_are_rejected(self) -> None:
        capsule = self._copy_seed()
        (capsule / "unexpected.txt").write_text("unexpected\n", encoding="utf-8")
        with self.assert_import_error("file_undeclared"):
            self.importer.import_path(capsule)

        (capsule / "unexpected.txt").unlink()
        (capsule / "evidence" / "requests.json").unlink()
        with self.assert_import_error("file_missing"):
            self.importer.import_path(capsule)

    def test_malformed_duplicate_json_keys_are_rejected(self) -> None:
        capsule = self._copy_seed()
        (capsule / "capsule.json").write_text(
            '{"schema_version":"1.0","schema_version":"1.0"}\n',
            encoding="utf-8",
        )

        with self.assert_import_error("manifest_invalid"):
            self.importer.import_path(capsule)

    def test_non_finite_json_and_oversized_archives_are_rejected(self) -> None:
        capsule = self._copy_seed()
        (capsule / "capsule.json").write_text(
            '{"schema_version":"1.0","value":NaN}\n',
            encoding="utf-8",
        )
        with self.assert_import_error("manifest_invalid"):
            self.importer.import_path(capsule)

        with self.assert_import_error("archive_too_large"):
            self.importer.import_zip_bytes(b"x" * (MAX_ARCHIVE_BYTES + 1))

    def test_zip_traversal_and_duplicate_paths_are_rejected(self) -> None:
        traversal = io.BytesIO()
        with zipfile.ZipFile(traversal, "w") as archive:
            archive.writestr("../capsule.json", "{}")
        with self.assert_import_error("unsafe_path"):
            self.importer.import_zip_bytes(traversal.getvalue())

        duplicate = io.BytesIO()
        with zipfile.ZipFile(duplicate, "w") as archive:
            archive.writestr("capsule.json", "{}")
            with self.assertWarns(UserWarning):
                archive.writestr("capsule.json", "{}")
        with self.assert_import_error("duplicate_path"):
            self.importer.import_zip_bytes(duplicate.getvalue())

    def test_symlink_is_rejected(self) -> None:
        capsule = self._copy_seed()
        link = capsule / "evidence" / "link.json"
        try:
            link.symlink_to(capsule / "evidence" / "requests.json")
        except (NotImplementedError, OSError):
            self.skipTest("Symlinks are not available")

        with self.assert_import_error("unsafe_entry"):
            self.importer.import_path(capsule)

    def test_wrong_media_type_and_conflicting_capsule_id_are_rejected(self) -> None:
        capsule = self._copy_seed()
        manifest_path = capsule / "capsule.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["evidence"][0]["media_type"] = "text/plain"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assert_import_error("media_type_unsupported"):
            self.importer.import_path(capsule)

        self.importer.import_path(SEED_CAPSULE)
        conflicting = self._copy_seed(name="conflicting")
        manifest_path = conflicting / "capsule.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["title"] = "Conflicting title"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assert_import_error("capsule_conflict"):
            self.importer.import_path(conflicting)

    def assert_import_error(self, code: str):
        return _ImportErrorContext(self, code)

    def _copy_seed(self, *, name: str = "capsule") -> Path:
        destination = self.root / name
        shutil.copytree(SEED_CAPSULE, destination)
        return destination

    def _update_evidence_metadata(
        self,
        capsule: Path,
        evidence_id: str,
        content: bytes,
    ) -> None:
        manifest_path = capsule / "capsule.json"
        manifest = json.loads(manifest_path.read_text())
        item = next(entry for entry in manifest["evidence"] if entry["evidence_id"] == evidence_id)
        item["byte_size"] = len(content)
        item["sha256"] = hashlib.sha256(content).hexdigest()
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    @staticmethod
    def _zip_directory(source: Path) -> bytes:
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(source.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(source).as_posix())
        return content.getvalue()


class _ImportErrorContext:
    def __init__(self, test: unittest.TestCase, code: str) -> None:
        self.test = test
        self.code = code
        self.context = test.assertRaises(CapsuleImportError)

    def __enter__(self) -> None:
        self.context.__enter__()

    def __exit__(self, exception_type, exception, traceback) -> bool:
        handled = self.context.__exit__(exception_type, exception, traceback)
        if handled:
            self.test.assertEqual(self.context.exception.code, self.code)
        return handled


if __name__ == "__main__":
    unittest.main()
