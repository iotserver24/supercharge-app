#!/usr/bin/env python3
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/package-arch-linux.sh"


class ArchPackageTests(unittest.TestCase):
    def test_release_workflow_requires_arch_package(self) -> None:
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        gate = (ROOT / "scripts/assert-release-assets.sh").read_text()
        expected = "Supercharge-${VER}-1-x86_64.pkg.tar.zst"
        self.assertIn("Build and upload Arch Linux package", workflow)
        self.assertIn(expected, workflow)
        self.assertIn(expected, gate)

    def test_aur_metadata_tracks_next_release(self) -> None:
        pkgbuild = (ROOT / "packaging/aur/PKGBUILD").read_text()
        srcinfo = (ROOT / "packaging/aur/.SRCINFO").read_text()
        self.assertIn("pkgver=0.2.43", pkgbuild)
        self.assertIn("pkgver = 0.2.43", srcinfo)
        for content in (pkgbuild, srcinfo):
            self.assertIn("webkit2gtk-4.1", content)
            self.assertIn("libayatana-appindicator", content)
        self.assertNotIn("libappindicator-gtk3", pkgbuild + srcinfo)

    def test_packager_rejects_missing_deb(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                ["bash", str(SCRIPT), "v9.9.9", str(Path(directory) / "missing.deb")],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("amd64 .deb not found", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
