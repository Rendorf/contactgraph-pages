#!/usr/bin/env python3
"""Local-only OSINT store and standards-based RSS/Atom parser."""
import argparse
import json
import sys
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

import duckdb


def input_json():
    return json.load(sys.stdin)


def rows(connection, sql, params=()):
    result = connection.execute(sql, params)
    names = [column[0] for column in result.description]
    return [dict(zip(names, row)) for row in result.fetchall()]


def text(element, name):
    for child in element:
        if child.tag.rsplit("}", 1)[-1] == name:
            return "".join(child.itertext()).strip()
    return ""


def parse_feed(raw):
    root = ET.fromstring(raw)
    output = []
    for entry in root.iter():
        if entry.tag.rsplit("}", 1)[-1] not in {"item", "entry"}:
            continue
        link = text(entry, "link")
        if not link:
            for child in entry:
                if child.tag.rsplit("}", 1)[-1] == "link" and child.attrib.get("href"):
                    link = child.attrib["href"]
                    break
        if not link.startswith(("https://", "http://")):
            continue
        output.append({
            "url": link,
            "title": text(entry, "title") or link,
            "summary": text(entry, "description") or text(entry, "summary"),
            "published": text(entry, "pubDate") or text(entry, "published") or text(entry, "updated"),
        })
    return output[:50]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=False)
    parser.add_argument("command")
    args = parser.parse_args()
    if args.command == "parse-feed":
        print(json.dumps(parse_feed(sys.stdin.read()), ensure_ascii=False))
        return
    if args.database is None:
        raise ValueError("Database path is required")
    args.database.parent.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect(str(args.database))
    connection.execute("""
        CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT false, daily_time VARCHAR NOT NULL DEFAULT '09:00', last_run_date VARCHAR, last_run_at VARCHAR);
        INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING;
        CREATE TABLE IF NOT EXISTS monitors (contact_id VARCHAR PRIMARY KEY, query VARCHAR NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true);
        CREATE TABLE IF NOT EXISTS feeds (id VARCHAR PRIMARY KEY, contact_id VARCHAR NOT NULL, url VARCHAR NOT NULL, UNIQUE(contact_id, url));
        CREATE TABLE IF NOT EXISTS items (id VARCHAR PRIMARY KEY, contact_id VARCHAR NOT NULL, url VARCHAR NOT NULL, title VARCHAR NOT NULL, summary VARCHAR, source VARCHAR NOT NULL, published VARCHAR, found_at VARCHAR NOT NULL, status VARCHAR NOT NULL, UNIQUE(contact_id, url));
        CREATE TABLE IF NOT EXISTS runs (id VARCHAR PRIMARY KEY, contact_id VARCHAR, started_at VARCHAR NOT NULL, finished_at VARCHAR, status VARCHAR NOT NULL, found INTEGER NOT NULL DEFAULT 0, error VARCHAR);
        CREATE TABLE IF NOT EXISTS candidates (id VARCHAR PRIMARY KEY, contact_id VARCHAR NOT NULL, kind VARCHAR NOT NULL, source_url VARCHAR NOT NULL, candidate_key VARCHAR NOT NULL, payload VARCHAR NOT NULL, found_at VARCHAR NOT NULL, status VARCHAR NOT NULL DEFAULT 'review', UNIQUE(contact_id, kind, candidate_key));
        CREATE TABLE IF NOT EXISTS provider_findings (id VARCHAR PRIMARY KEY, contact_id VARCHAR NOT NULL, provider VARCHAR NOT NULL, finding_key VARCHAR NOT NULL, url VARCHAR NOT NULL, title VARCHAR NOT NULL, summary VARCHAR, published VARCHAR, payload VARCHAR NOT NULL, found_at VARCHAR NOT NULL, last_seen_at VARCHAR NOT NULL, status VARCHAR NOT NULL DEFAULT 'review', UNIQUE(contact_id, provider, finding_key));
    """)
    monitor_columns = {row[1] for row in connection.execute("PRAGMA table_info('monitors')").fetchall()}
    if "providers" not in monitor_columns:
        connection.execute("ALTER TABLE monitors ADD COLUMN providers VARCHAR DEFAULT '[\"web\",\"gdelt\",\"wikidata\",\"openalex\",\"maigret\"]'")
    if "handles" not in monitor_columns:
        connection.execute("ALTER TABLE monitors ADD COLUMN handles VARCHAR DEFAULT '[]'")
    item_columns = {row[1] for row in connection.execute("PRAGMA table_info('items')").fetchall()}
    if "provider" not in item_columns:
        connection.execute("ALTER TABLE items ADD COLUMN provider VARCHAR DEFAULT 'web'")
    command = args.command
    payload = input_json() if command in {"settings-update", "mark-daily", "monitor-save", "feed-add", "feed-delete", "items-save", "item-update", "run-start", "run-finish", "candidates-save", "candidate-update", "candidate-get", "findings-save", "finding-update", "contact-reports"} else {}
    if command == "health":
        result = {"available": True}
    elif command == "snapshot":
        result = {
            "settings": rows(connection, "SELECT enabled, daily_time, last_run_date, last_run_at FROM settings WHERE id = 1")[0],
            "monitors": [{**row, "providers": ["web" if value == "searxng" else value for value in json.loads(row["providers"])], "handles": json.loads(row["handles"])} for row in rows(connection, "SELECT contact_id, query, enabled, providers, handles FROM monitors ORDER BY contact_id")],
            "feeds": rows(connection, "SELECT id, contact_id, url FROM feeds ORDER BY contact_id, url"),
            "items": rows(connection, "SELECT * FROM items ORDER BY found_at DESC LIMIT 500"),
            "runs": rows(connection, "SELECT * FROM runs ORDER BY started_at DESC LIMIT 30"),
            "candidates": [{**row, "payload": json.loads(row["payload"])} for row in rows(connection, "SELECT * FROM candidates ORDER BY found_at DESC LIMIT 500")],
            "findings": [{**row, "payload": json.loads(row["payload"])} for row in rows(connection, "SELECT * FROM provider_findings ORDER BY found_at DESC LIMIT 500")],
        }
    elif command == "contact-reports":
        contact_id = payload.get("contact_id")
        if not isinstance(contact_id, str) or not contact_id or len(contact_id) > 200:
            raise ValueError("Invalid contact ID")
        result = {
            "items": rows(connection, "SELECT * FROM items WHERE contact_id = ? AND status <> 'dismissed' ORDER BY found_at DESC LIMIT 500", [contact_id]),
            "candidates": [{**row, "payload": json.loads(row["payload"])} for row in rows(connection, "SELECT * FROM candidates WHERE contact_id = ? AND status <> 'dismissed' ORDER BY found_at DESC LIMIT 500", [contact_id])],
            "findings": [{**row, "payload": json.loads(row["payload"])} for row in rows(connection, "SELECT * FROM provider_findings WHERE contact_id = ? AND status <> 'dismissed' ORDER BY found_at DESC LIMIT 500", [contact_id])],
        }
    elif command == "settings-update":
        enabled, daily_time = payload.get("enabled"), payload.get("daily_time")
        if not isinstance(enabled, bool) or not isinstance(daily_time, str) or len(daily_time) != 5 or daily_time[2] != ":" or not ("00" <= daily_time[:2] <= "23" and "00" <= daily_time[3:] <= "59"):
            raise ValueError("Invalid schedule")
        connection.execute("UPDATE settings SET enabled = ?, daily_time = ? WHERE id = 1", [enabled, daily_time])
        result = rows(connection, "SELECT enabled, daily_time, last_run_date, last_run_at FROM settings WHERE id = 1")[0]
    elif command == "mark-daily":
        from datetime import datetime, timezone
        date = payload.get("date")
        if not isinstance(date, str) or len(date) != 10:
            raise ValueError("Invalid run date")
        connection.execute("UPDATE settings SET last_run_date = ?, last_run_at = ? WHERE id = 1", [date, datetime.now(timezone.utc).isoformat()])
        result = {"ok": True}
    elif command == "monitor-save":
        contact_id, query, enabled = payload.get("contact_id"), payload.get("query"), payload.get("enabled", True)
        providers = ["web" if value == "searxng" else value for value in payload.get("providers", ["web", "gdelt", "wikidata", "openalex", "maigret"])]
        handles = payload.get("handles", [])
        if not isinstance(contact_id, str) or not contact_id or not isinstance(query, str) or not query.strip() or len(query) > 300 or not isinstance(enabled, bool):
            raise ValueError("Invalid monitor")
        if not isinstance(providers, list) or not providers or len(providers) > 5 or len(set(providers)) != len(providers) or any(value not in {"web", "gdelt", "wikidata", "openalex", "maigret"} for value in providers):
            raise ValueError("Invalid monitored providers")
        if not isinstance(handles, list) or len(handles) > 3 or any(not isinstance(value, str) or not 2 <= len(value) <= 40 or not all(character.isalnum() or character in "._-" for character in value) for value in handles):
            raise ValueError("Invalid monitored handles")
        if enabled and connection.execute("SELECT count(*) FROM monitors WHERE enabled AND contact_id != ?", [contact_id]).fetchone()[0] >= 25:
            raise ValueError("A maximum of 25 contacts can be monitored")
        connection.execute("INSERT INTO monitors (contact_id, query, enabled, providers, handles) VALUES (?, ?, ?, ?, ?) ON CONFLICT (contact_id) DO UPDATE SET query=excluded.query, enabled=excluded.enabled, providers=excluded.providers, handles=excluded.handles", [contact_id, query.strip(), enabled, json.dumps(providers), json.dumps(handles)])
        result = {"ok": True}
    elif command == "feed-add":
        contact_id, url = payload.get("contact_id"), payload.get("url")
        if not isinstance(contact_id, str) or not contact_id or not isinstance(url, str) or len(url) > 2048:
            raise ValueError("Invalid feed")
        feed_id = str(uuid.uuid4())
        connection.execute("INSERT INTO feeds VALUES (?, ?, ?) ON CONFLICT (contact_id, url) DO NOTHING", [feed_id, contact_id, url])
        result = {"ok": True}
    elif command == "feed-delete":
        connection.execute("DELETE FROM feeds WHERE id = ?", [payload.get("id")])
        result = {"ok": True}
    elif command == "items-save":
        contact_id = payload.get("contact_id")
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        added = 0
        for item in payload.get("items", [])[:100]:
            if not isinstance(item.get("url"), str) or not item["url"].startswith(("https://", "http://")):
                continue
            status = "saved" if item.get("confirmed") else "review"
            result_row = connection.execute("INSERT INTO items (id, contact_id, url, title, summary, source, published, found_at, status, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (contact_id, url) DO NOTHING RETURNING id", [str(uuid.uuid4()), contact_id, item["url"][:2048], str(item.get("title") or item["url"])[:500], str(item.get("summary") or "")[:2000], str(item.get("source") or "web")[:100], str(item.get("published") or "")[:100], now, status, str(item.get("provider") or "web")[:40]]).fetchone()
            added += bool(result_row)
        result = {"added": added}
    elif command == "item-update":
        status = payload.get("status")
        if status not in {"saved", "dismissed"}:
            raise ValueError("Invalid status")
        connection.execute("UPDATE items SET status = ? WHERE id = ?", [status, payload.get("id")])
        result = {"ok": True}
    elif command == "candidates-save":
        from datetime import datetime, timezone
        contact_id = payload.get("contact_id")
        if not isinstance(contact_id, str) or not contact_id:
            raise ValueError("A contact is required")
        added = 0
        for candidate in payload.get("candidates", [])[:50]:
            kind = candidate.get("kind")
            source_url = candidate.get("source_url")
            key = candidate.get("candidate_key")
            if kind not in {"photo", "position"} or not isinstance(source_url, str) or not source_url.startswith("https://") or not isinstance(key, str) or not key:
                continue
            entry = connection.execute("INSERT INTO candidates VALUES (?, ?, ?, ?, ?, ?, ?, 'review') ON CONFLICT (contact_id, kind, candidate_key) DO NOTHING RETURNING id", [str(uuid.uuid4()), contact_id, kind, source_url[:2048], key[:2048], json.dumps(candidate, ensure_ascii=False), datetime.now(timezone.utc).isoformat()]).fetchone()
            added += bool(entry)
        result = {"added": added}
    elif command == "candidate-get":
        found = rows(connection, "SELECT * FROM candidates WHERE id = ?", [payload.get("id")])
        result = {**found[0], "payload": json.loads(found[0]["payload"])} if found else None
    elif command == "candidate-update":
        status = payload.get("status")
        if status not in {"confirmed", "dismissed"}:
            raise ValueError("Invalid candidate status")
        connection.execute("UPDATE candidates SET status = ? WHERE id = ? AND status = 'review'", [status, payload.get("id")])
        result = {"ok": True}
    elif command == "findings-save":
        from datetime import datetime, timezone
        contact_id = payload.get("contact_id")
        if not isinstance(contact_id, str) or not contact_id:
            raise ValueError("A contact is required")
        now = datetime.now(timezone.utc).isoformat()
        added = 0
        for finding in payload.get("findings", [])[:100]:
            provider, key, url = finding.get("provider"), finding.get("key"), finding.get("url")
            if provider not in {"gdelt", "wikidata", "openalex", "maigret"} or not isinstance(key, str) or not key or not isinstance(url, str) or not url.startswith("https://"):
                continue
            result_row = connection.execute("INSERT INTO provider_findings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review') ON CONFLICT (contact_id, provider, finding_key) DO NOTHING RETURNING id", [str(uuid.uuid4()), contact_id, provider, key[:2048], url[:2048], str(finding.get("title") or url)[:500], str(finding.get("summary") or "")[:2000], str(finding.get("published") or "")[:100], json.dumps(finding, ensure_ascii=False), now, now]).fetchone()
            if result_row:
                added += 1
            else:
                connection.execute("UPDATE provider_findings SET last_seen_at = ? WHERE contact_id = ? AND provider = ? AND finding_key = ?", [now, contact_id, provider, key[:2048]])
        result = {"added": added}
    elif command == "finding-update":
        status = payload.get("status")
        if status not in {"saved", "dismissed"}:
            raise ValueError("Invalid finding status")
        connection.execute("UPDATE provider_findings SET status = ? WHERE id = ?", [status, payload.get("id")])
        result = {"ok": True}
    elif command == "run-start":
        run_id = str(uuid.uuid4())
        from datetime import datetime, timezone
        connection.execute("INSERT INTO runs (id, contact_id, started_at, status) VALUES (?, ?, ?, 'running')", [run_id, payload.get("contact_id"), datetime.now(timezone.utc).isoformat()])
        result = {"id": run_id}
    elif command == "run-finish":
        from datetime import datetime, timezone
        connection.execute("UPDATE runs SET finished_at = ?, status = ?, found = ?, error = ? WHERE id = ?", [datetime.now(timezone.utc).isoformat(), payload.get("status"), int(payload.get("found", 0)), str(payload.get("error") or "")[:1000], payload.get("id")])
        result = {"ok": True}
    else:
        raise ValueError(f"Unknown command: {command}")
    print(json.dumps(result, ensure_ascii=False))
    connection.close()


if __name__ == "__main__":
    main()
