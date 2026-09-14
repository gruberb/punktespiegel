import json
import shutil
import tempfile
import unittest
from pathlib import Path

from recommender import config


class ConfigTests(unittest.TestCase):
    def test_bundled_defaults_and_custom_overrides(self) -> None:
        bundled_dir = config.REPO_ROOT / "config" / "recommender"
        bundled = json.loads((bundled_dir / "defaults.json").read_text())
        config.initialize(bundled_dir, Path("data"))
        self.assertEqual(config.model_default("iterations"), bundled["model"]["iterations"])
        with tempfile.TemporaryDirectory() as directory:
            custom_dir = Path(directory)
            shutil.copyfile(bundled_dir / "bundesliga.json", custom_dir / "bundesliga.json")
            config.initialize(custom_dir, Path("data"))
            self.assertEqual(config.model_default("iterations"), bundled["model"]["iterations"])
            self.assertEqual(config.classic_starter_counts(), bundled["squadRules"]["classic"]["starterCounts"])
            overrides = {"model": {"iterations": 7}, "baseline": {"command": ["custom-baseline"]}}
            (custom_dir / "defaults.json").write_text(json.dumps(overrides))
            config.initialize(custom_dir, Path("data"))
            self.assertEqual(config.model_default("iterations"), 7)
            self.assertEqual(config.model_default("validationIterations"), bundled["model"]["validationIterations"])
            self.assertEqual(config.baseline_command(), ["custom-baseline"])
            self.assertEqual(config.baseline_cwd(), config.REPO_ROOT)
            self.assertEqual(config.interactive_roster_counts(), bundled["squadRules"]["interactive"]["rosterCounts"])


if __name__ == "__main__":
    unittest.main()
