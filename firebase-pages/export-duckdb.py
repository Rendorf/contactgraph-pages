"""Export a closed ContactGraph DuckDB backup for private Firebase migration.

Run from contactgraph-app with the root venv. The output stays outside this
public source repository and is never used by the Pages build.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import duckdb

APP_ROOT = Path(__file__).resolve().parents[1]
ROOT = APP_ROOT.parent
sys.path.insert(0, str(ROOT / "scripts"))
from contactdb import list_canvases, list_contacts, list_holiday_messages, list_holidays, list_meetings  # noqa: E402


OSINT_TABLES = ("settings", "monitors", "feeds", "items", "runs", "candidates", "provider_findings")


def export(database: Path, output: Path, osint_database: Path | None = None) -> dict[str, int]:
    database = database.resolve(strict=True)
    output = output.resolve()
    if output == database or output.is_relative_to(APP_ROOT) or output.suffix != ".json":
        raise ValueError("Choose a private JSON output path outside the public app repository.")
    connection = duckdb.connect(str(database), read_only=True)
    try:
        actions = [dict(zip(("id", "contact_id", "title", "due_date", "status", "completed_on"), row))
                   for row in connection.execute("SELECT id, contact_id, title, due_date::VARCHAR, status, completed_on::VARCHAR FROM followup_actions").fetchall()]
        settings = [dict(zip(("id", "cadence_days", "snoozed_until", "dismissed_activity_on"), row))
                    for row in connection.execute("SELECT contact_id, cadence_days, snoozed_until::VARCHAR, dismissed_activity_on::VARCHAR FROM followup_settings").fetchall()]
        roles = [{"id": id_, "name": name, "permissions": json.loads(permissions)}
                 for id_, name, permissions in connection.execute("SELECT id, name, permissions FROM auth_roles").fetchall()]
        members = [{"id": id_, "username": username, "display_name": display_name, "role_id": role_id,
                    "active": active, "email": email.lower() if email else None}
                   for id_, username, display_name, role_id, active, email in connection.execute(
                       "SELECT id, username, display_name, role_id, active, email FROM auth_users"
                   ).fetchall()]
        data = {
            "contacts": list_contacts(connection),
            "holidays": list_holidays(connection),
            "holiday_messages": list_holiday_messages(connection),
            "canvases": list_canvases(connection),
            "meetings": list_meetings(connection),
            "followup_actions": actions,
            "followup_settings": settings,
            "roles": roles,
            "members": members,
        }
    finally:
        connection.close()
    if osint_database:
        osint = duckdb.connect(str(osint_database.resolve(strict=True)), read_only=True)
        try:
            for table in OSINT_TABLES:
                rows = osint.execute(f'SELECT * FROM "{table}"').fetchall()
                columns = [item[0] for item in osint.description]
                data[f"osint_{table}"] = [dict(zip(columns, row)) for row in rows]
        finally:
            osint.close()
    else:
        for table in OSINT_TABLES:
            data[f"osint_{table}"] = []
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, separators=(",", ":"), default=str)
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    counts = {name: len(items) for name, items in data.items()}
    print(json.dumps({"output": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "counts": counts}))
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--osint-database", type=Path)
    args = parser.parse_args()
    export(args.database, args.output, args.osint_database)
