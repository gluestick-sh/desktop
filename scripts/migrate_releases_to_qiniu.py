#!/usr/bin/env python3
"""Download GitHub Release assets and upload them to Qiniu.

For gluestick-sh/desktop (Gluestick Desktop Free) release archives.

Requires: gh (authenticated), Python 3.10+, ``pip install qiniu``

Environment:
  QINIU_ACCESS_KEY    AccessKey
  QINIU_SECRET_KEY    SecretKey
  QINIU_BUCKET        Bucket name
  QINIU_KEY_PREFIX    Object key prefix (default: desktop)
  GH_REPO             owner/name (default: git remote origin, else gluestick-sh/desktop)

Examples:
  python scripts/migrate_releases_to_qiniu.py v0.1.24 v0.1.25 --dry-run
  python scripts/migrate_releases_to_qiniu.py v0.1.18 --delete-github-assets
  python scripts/migrate_releases_to_qiniu.py --all
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# qiniu is imported in main() so --help works without the SDK.


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, text=True, **kw)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise SystemExit(f"command failed ({proc.returncode}): {' '.join(cmd)}\n{err}")
    return proc


def gh_repo() -> str:
    if os.environ.get("GH_REPO"):
        return os.environ["GH_REPO"].strip()
    try:
        out = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            check=True,
        )
        match = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", out.stdout.strip())
        if match:
            return f"{match.group(1)}/{match.group(2)}"
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    return "gluestick-sh/desktop"


def list_tags(repo: str) -> list[str]:
    raw = run(
        ["gh", "release", "list", "-R", repo, "--limit", "200", "--json", "tagName"],
        capture_output=True,
    )
    return [x["tagName"] for x in json.loads(raw.stdout)]


def list_assets(repo: str, tag: str) -> list[dict]:
    raw = run(
        ["gh", "release", "view", tag, "-R", repo, "--json", "assets"],
        capture_output=True,
    )
    return json.loads(raw.stdout).get("assets") or []


def gh_download_one(repo: str, tag: str, name: str, dest: Path, attempts: int = 5) -> None:
    last = ""
    for i in range(1, attempts + 1):
        proc = subprocess.run(
            ["gh", "release", "download", tag, "-R", repo, "-D", str(dest), "-p", name],
            capture_output=True,
            text=True,
        )
        if proc.returncode == 0 and (dest / name).is_file():
            return
        last = (proc.stderr or proc.stdout or "").strip() or f"exit {proc.returncode}"
        wait = min(2 ** (i - 1), 16)
        print(f"  download retry {i}/{attempts} {name}: {last}", file=sys.stderr)
        time.sleep(wait)
    raise SystemExit(f"download failed {tag}/{name}: {last}")


def object_exists(bucket_mgr, bucket: str, key: str) -> bool:
    try:
        ret, info = bucket_mgr.stat(bucket, key)
    except RuntimeError as err:
        text = str(err)
        if "no such bucket" in text or "631" in text:
            raise SystemExit(
                f"Qiniu bucket {bucket!r} does not exist. Check QINIU_BUCKET spelling."
            ) from err
        raise SystemExit(f"Qiniu stat failed: {err}") from err
    if info.status_code == 200 and ret:
        return True
    if info.status_code in (404, 612):
        return False
    raise SystemExit(f"stat failed {key}: {info.status_code} {info.text_body}")


def upload_one(auth, bucket: str, key: str, local: Path) -> None:
    from qiniu import etag, put_file_v2
    token = auth.upload_token(bucket, key, 3600)
    ret, info = put_file_v2(token, key, str(local))
    if info.status_code != 200:
        raise SystemExit(f"upload failed {key}: {info.status_code} {info.text_body}")
    local_etag = etag(str(local))
    remote_hash = (ret or {}).get("hash")
    if remote_hash and remote_hash != local_etag:
        print(f"  warning: etag mismatch for {key}", file=sys.stderr)


def delete_github_asset(repo: str, tag: str, name: str) -> None:
    run(["gh", "release", "delete-asset", tag, name, "-R", repo, "--yes"], capture_output=True)


def migrate_tag(
    auth,
    bucket_mgr,
    bucket: str,
    repo: str,
    tag: str,
    prefix: str,
    dry_run: bool,
    delete_github: bool,
) -> None:
    assets = list_assets(repo, tag)
    if not assets:
        print(f"{tag}: no assets, skip")
        return
    print(f"{tag}: {len(assets)} file(s)")

    to_upload: list[dict] = []
    for asset in assets:
        name = asset["name"]
        size = int(asset.get("size") or 0)
        key = f"{prefix}/{tag}/{name}"
        exists = False
        if bucket_mgr is not None:
            exists = object_exists(bucket_mgr, bucket, key)
        if dry_run:
            state = "exists" if exists else "missing"
            print(f"  DRY [{state}] {name}  {size / (1024 * 1024):.1f} MiB  ->  {key}")
            continue
        if exists:
            print(f"  skip existing {key}")
            if delete_github:
                delete_github_asset(repo, tag, name)
                print(f"  deleted GitHub asset {tag}/{name}")
            continue
        to_upload.append(asset)
    if dry_run or not to_upload:
        return

    with tempfile.TemporaryDirectory(prefix=f"gh-{tag}-") as tmp:
        dest = Path(tmp)
        for asset in to_upload:
            name = asset["name"]
            key = f"{prefix}/{tag}/{name}"
            print(f"  downloading {name}")
            gh_download_one(repo, tag, name, dest)
            local = dest / name
            if not local.is_file():
                print(f"  missing after download: {name}", file=sys.stderr)
                continue
            size_mb = local.stat().st_size / (1024 * 1024)
            print(f"  {name}  {size_mb:.1f} MiB  ->  {key}")
            assert auth is not None
            upload_one(auth, bucket, key, local)
            if delete_github:
                delete_github_asset(repo, tag, name)
                print(f"  deleted GitHub asset {tag}/{name}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Copy GitHub Release assets to Qiniu.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("tags", nargs="*", help="release tags, e.g. v0.1.24")
    parser.add_argument("--all", action="store_true", help="all releases in the repo")
    parser.add_argument("--dry-run", action="store_true", help="stat Qiniu keys, do not download or upload")
    parser.add_argument(
        "--delete-github-assets",
        action="store_true",
        help="after upload (or if already in Qiniu), delete that file from the GitHub Release (tag/notes stay)",
    )
    parser.add_argument(
        "--prefix",
        default=os.environ.get("QINIU_KEY_PREFIX", "desktop"),
        help="object key prefix (default: env QINIU_KEY_PREFIX or desktop)",
    )
    args = parser.parse_args()

    ak = os.environ.get("QINIU_ACCESS_KEY", "hQdo6gX6Uqft6OH3lZfnKYbHheC-HrP3mV0yrAzS").strip()
    sk = os.environ.get("QINIU_SECRET_KEY", "TnEqhJ1KS5EJEMK81DQslTWF9zTEzp8RRmxVFYQR").strip()
    bucket = os.environ.get("QINIU_BUCKET", "gluestick").strip()
    if not ak or not sk or not bucket:
        print("set QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET", file=sys.stderr)
        return 2
    if args.delete_github_assets and args.dry_run:
        print("--delete-github-assets cannot be used with --dry-run", file=sys.stderr)
        return 2

    repo = gh_repo()
    tags = list_tags(repo) if args.all else args.tags
    if not tags:
        print("specify tags or --all", file=sys.stderr)
        return 2

    try:
        from qiniu import Auth, BucketManager
    except ImportError:
        print("pip install qiniu", file=sys.stderr)
        return 2
    auth = Auth(ak, sk)
    bucket_mgr = BucketManager(auth)
    prefix = args.prefix.strip().strip("/")
    print(f"repo={repo} bucket={bucket} prefix={prefix}")
    for tag in tags:
        migrate_tag(
            auth,
            bucket_mgr,
            bucket,
            repo,
            tag,
            prefix,
            args.dry_run,
            args.delete_github_assets,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
