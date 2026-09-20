#!/usr/bin/env python3
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIB = (ROOT / "src-tauri/src/lib.rs").read_text()
BROWSER = (ROOT / "src-tauri/src/linux_browser.rs").read_text()


class LinuxWebkitStartupTests(unittest.TestCase):
    def test_appimage_system_webkit_fallback_is_wired_before_runtime_start(self) -> None:
        self.assertIn('mod linux_webkit;', LIB)
        reexec = LIB.index('linux_webkit::maybe_reexec_for_system_webkit();')
        heartbeat = LIB.index('crate::host_runtime::on_process_start();')
        self.assertLess(reexec, heartbeat)
        self.assertIn('linux_webkit::log_system_webkit_choice();', LIB)
        self.assertIn('linux_webkit::wait_for_appimage_webkit_helpers();', LIB)

    def test_safe_renderer_default_is_not_limited_to_wayland(self) -> None:
        prepare = re.search(
            r'pub fn prepare_process\(\) \{(?P<body>.*?)\n\}', BROWSER, re.S
        )
        self.assertIsNotNone(prepare)
        body = prepare.group('body')
        self.assertIn('WEBKIT_DISABLE_DMABUF_RENDERER', body)
        self.assertNotIn('WAYLAND_DISPLAY', body)
        self.assertNotIn('GDK_BACKEND', body)
        self.assertIn('renderer_override(current)', body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
