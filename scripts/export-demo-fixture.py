"""Export the backend's fictional demo scenario for the standalone app."""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.demo import PLACES, demo_lots  # noqa: E402

now = datetime.now(UTC)
rows = []
for lot in demo_lots():
    row = lot.model_dump(mode="json", exclude={"observed_at", "fetched_at"})
    row["observed_age_seconds"] = (
        round((now - lot.observed_at).total_seconds()) if lot.observed_at else None
    )
    rows.append(row)
target = ROOT / "frontend/src/data/demo.json"
target.parent.mkdir(exist_ok=True)
target.write_text(
    json.dumps(
        {"places": [p.model_dump() for p in PLACES], "lots": rows}, ensure_ascii=False, indent=2
    )
    + "\n"
)
print(f"Exported {len(rows)} fictional facilities to {target}")
