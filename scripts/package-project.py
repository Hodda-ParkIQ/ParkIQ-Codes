"""Bundle source, the built web UI and the debug APK without local secrets/caches."""

import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release"


def main():
    OUT.mkdir(exist_ok=True)
    apk = ROOT / "android/app/build/outputs/apk/debug/app-debug.apk"
    if not apk.exists() or not (ROOT / "frontend/dist/index.html").exists():
        raise SystemExit("Build the frontend and Android debug APK first.")
    # Prevent distributing an APK with a stale or missing bundled UI.
    with zipfile.ZipFile(apk) as android:
        for file in (ROOT / "frontend/dist").rglob("*"):
            if file.is_file():
                asset = "assets/" + file.relative_to(ROOT / "frontend/dist").as_posix()
                assert android.read(asset) == file.read_bytes(), f"Rebuild APK: {asset} differs"
        assert (
            android.read("assets/schema.json")
            == (ROOT / "android/gleo-app-schema.json").read_bytes()
        )
    shutil.copy2(apk, OUT / "ParkIQ-debug.apk")
    preview = ROOT / "artifacts/emulator-live.png"
    if not preview.exists():
        preview = ROOT / "artifacts/vehicle-live.png"
    if preview.exists():
        shutil.copy2(preview, OUT / "ParkIQ-preview.png")
    files = [
        ROOT / name
        for name in [
            "README.md",
            ".gitignore",
            ".dockerignore",
            ".env.example",
            "Dockerfile",
            "compose.yaml",
            "pyproject.toml",
        ]
    ]
    for directory in ["backend", "frontend", "db", "android", "docs", "scripts"]:
        for file in (ROOT / directory).rglob("*"):
            relative = file.relative_to(ROOT)
            if not file.is_file() or any(
                part
                in {
                    "node_modules",
                    "__pycache__",
                    ".gradle",
                    ".pytest_cache",
                    ".ruff_cache",
                    "build",
                }
                for part in relative.parts
            ):
                continue
            if file.name.startswith(".env") and file.name != ".env.example":
                continue
            if file.name == "local.properties" or file.suffix in {".pyc", ".tsbuildinfo"}:
                continue
            files.append(file)
    with zipfile.ZipFile(OUT / "ParkIQ-project.zip", "w", zipfile.ZIP_DEFLATED) as bundle:
        for file in sorted(set(files)):
            bundle.write(file, Path("ParkIQ") / file.relative_to(ROOT))
        bundle.write(OUT / "ParkIQ-debug.apk", "ParkIQ/release/ParkIQ-debug.apk")
    with zipfile.ZipFile(OUT / "ParkIQ-project.zip") as bundle:
        assert bundle.testzip() is None
        assert "ParkIQ/frontend/dist/index.html" in bundle.namelist()
        assert "ParkIQ/android/gradle/wrapper/gradle-wrapper.jar" in bundle.namelist()
        assert not any(
            "/.env" in name and not name.endswith(".env.example") for name in bundle.namelist()
        )
        print(f"Packaged {len(bundle.namelist())} files")
    for file in OUT.iterdir():
        print(f"{file.name}: {file.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
