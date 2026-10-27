#!/usr/bin/env python3
"""
pkg's nightly backup (the owner, 2026-10-19: Supabase Cloud on the Free plan has none).

Runs on vps-new as deploy, 03:00 Asia/Riyadh (00:00 UTC, deploy's crontab):
  1. the database — pg_dump of SUPABASE_DB_URL, custom format, every schema the
     postgres role reads (public, auth, storage …), with the supabase-db
     container's pg_dump (the cloud's major, 17);
  2. the files — every Storage bucket mirrored incrementally into
     .storage-mirror (only new or changed objects are downloaded: the Free plan's
     egress is 5 GB a month), then hard-linked into the night's folder, so each
     night is a whole copy that costs only what changed;
  3. /home/deploy/backups/pkg/YYYY-MM-DD, mode 700 (passports are in there),
     14 nights kept;
  4. the result in app_settings.pkg_backup, which «الربط الخارجي»'s check
     backup_pkg reads (lib/developer/checks.ts): stale over 26 h or too small
     alerts the administration through «عين الإدارة».

The secrets come from the app's .env and travel only in environment variables
(PGPASSWORD …) and request headers — never in a command line, never in the log.
Restore: pg_restore --no-owner --no-acl -d <db> db.dump (see the commit that
added this file for the tested restore).
"""
import json
import pwd
import fcntl
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ENV_FILE = "/home/deploy/apps/traveliun-app/.env"
ROOT = "/home/deploy/backups/pkg"
MIRROR = os.path.join(ROOT, ".storage-mirror")
KEEP_DAYS = 14
RIYADH = timezone(timedelta(hours=3))


def log(msg):
    print(f"{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S}Z {msg}", flush=True)


def read_env():
    env = {}
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def dump_database(db_url, path):
    u = urllib.parse.urlparse(db_url)
    child = dict(os.environ)
    child.update({
        "PGHOST": u.hostname or "",
        "PGPORT": str(u.port or 5432),
        "PGUSER": urllib.parse.unquote(u.username or ""),
        "PGPASSWORD": urllib.parse.unquote(u.password or ""),
        "PGDATABASE": (u.path or "/postgres").lstrip("/") or "postgres",
        "PGSSLMODE": "require",
    })
    names = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE"]
    # `-e NAME` with no value hands the container this process's value: nothing secret in argv
    cmd = ["docker", "exec", "-i"] + sum([["-e", n] for n in names], []) + ["supabase-db", "pg_dump", "-Fc", "-Z", "6", "--no-owner", "--no-acl"]
    with open(path, "wb") as out:
        res = subprocess.run(cmd, env=child, stdout=out, stderr=subprocess.PIPE)
    err = res.stderr.decode("utf-8", "replace").strip()
    if res.returncode != 0:
        raise RuntimeError(f"pg_dump exited {res.returncode}: {err[-500:]}")
    if err:
        log(f"pg_dump notes: {err[-500:]}")
    return os.path.getsize(path)


def api(base, key, method, path, body=None):
    req = urllib.request.Request(
        f"{base}{path}",
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def list_objects(base, key, bucket, prefix=""):
    out, offset = [], 0
    while True:
        page = json.loads(api(base, key, "POST", f"/storage/v1/object/list/{bucket}", {
            "prefix": prefix, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"},
        }))
        for item in page:
            name = f"{prefix}{item['name']}"
            if item.get("id") is None:  # a folder
                out += list_objects(base, key, bucket, f"{name}/")
            else:
                meta = item.get("metadata") or {}
                out.append((name, meta.get("size", 0), item.get("updated_at") or ""))
        if len(page) < 1000:
            return out
        offset += 1000


def mirror_storage(base, key):
    os.makedirs(MIRROR, exist_ok=True)
    manifest_path = os.path.join(MIRROR, ".manifest.json")
    try:
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        manifest = {}
    seen, fetched, total, count = {}, 0, 0, 0
    for b in json.loads(api(base, key, "GET", "/storage/v1/bucket")):
        bucket = b["name"]
        for name, size, updated in list_objects(base, key, bucket):
            rel = f"{bucket}/{name}"
            local = os.path.join(MIRROR, bucket, *name.split("/"))
            stamp = f"{size}|{updated}"
            seen[rel] = stamp
            count += 1
            total += size or 0
            if manifest.get(rel) == stamp and os.path.exists(local):
                continue
            os.makedirs(os.path.dirname(local), exist_ok=True)
            quoted = "/".join(urllib.parse.quote(p) for p in name.split("/"))
            data = api(base, key, "GET", f"/storage/v1/object/{urllib.parse.quote(bucket)}/{quoted}")
            with open(local + ".part", "wb") as f:
                f.write(data)
            os.replace(local + ".part", local)
            fetched += 1
    # an object deleted in Storage leaves the mirror; the older nights keep their link to it
    for rel in set(manifest) - set(seen):
        try:
            os.remove(os.path.join(MIRROR, *rel.split("/")))
        except OSError:
            pass
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(seen, f)
    return count, fetched, total


def record(base, key, status):
    req = urllib.request.Request(
        f"{base}/rest/v1/app_settings?on_conflict=key",
        method="POST",
        data=json.dumps({"key": "pkg_backup", "value": json.dumps(status), "updated_at": datetime.now(timezone.utc).isoformat()}).encode(),
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    urllib.request.urlopen(req, timeout=30).read()


def prune():
    cutoff = (datetime.now(RIYADH) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    for name in os.listdir(ROOT):
        if len(name) == 10 and name[4] == "-" and name < cutoff:
            shutil.rmtree(os.path.join(ROOT, name), ignore_errors=True)
            log(f"removed {name}")


def main():
    # A manual root invocation must never create files the nightly deploy job cannot read.
    if os.geteuid() == 0:
        account = pwd.getpwnam("deploy")
        os.initgroups(account.pw_name, account.pw_gid)
        os.setgid(account.pw_gid)
        os.setuid(account.pw_uid)
    os.umask(0o077)
    lock = open(os.path.join(ROOT, ".backup.lock"), "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("another backup is running")
        return 0
    env = read_env()
    base, key = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]
    day = datetime.now(RIYADH).strftime("%Y-%m-%d")
    out = os.path.join(ROOT, day)
    started = time.time()
    status = {"day": day, "ok": False}
    try:
        os.makedirs(out, exist_ok=True)
        os.chmod(ROOT, 0o700)
        os.chmod(out, 0o700)
        dump = os.path.join(out, "db.dump")
        status["dump_bytes"] = dump_database(env["SUPABASE_DB_URL"], dump + ".part")
        os.replace(dump + ".part", dump)
        log(f"database: {status['dump_bytes']} bytes")
        status["objects"], status["fetched"], status["files_bytes"] = mirror_storage(base, key)
        files = os.path.join(out, "storage")
        if os.path.exists(files):
            shutil.rmtree(files)
        subprocess.run(["cp", "-al", MIRROR, files], check=True)
        os.remove(os.path.join(files, ".manifest.json"))
        log(f"storage: {status['objects']} objects, {status['fetched']} fetched tonight, {status['files_bytes']} bytes")
        status["ok"] = True
        prune()
    except Exception as e:  # recorded, so the check alerts; the message never carries a secret
        status["error"] = str(e)[:300]
        log(f"FAILED: {status['error']}")
    status["seconds"] = round(time.time() - started)
    status["at"] = datetime.now(timezone.utc).isoformat()
    try:
        record(base, key, status)
    except Exception as e:
        log(f"could not record the result: {str(e)[:200]}")
    return 0 if status["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
