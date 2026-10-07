#!/usr/bin/env bash
# PineCloud (Nextcloud at files.pinefrostdb.com) nightly backup.
#
# Takes a consistent copy of everything needed to rebuild the instance:
#   db.sql.gz      the MariaDB database (nextcloud-db)
#   files.tar.gz   the whole nextcloud_nc_data volume = /var/www/html: user files,
#                  config/config.php (instance secrets, hence the 700/600 permissions),
#                  installed apps and themes
#   SHA256SUMS     checksums of both
#
# Consistency: Nextcloud is put into maintenance mode while the database and the
# files are copied (about a minute for ~1 GB), then taken out again - always, even
# if the copy fails. Each backup is built in a hidden ".incomplete-*" directory and
# renamed only after both archives verify, so a half-written backup can never be
# mistaken for a good one. Old backups beyond PINECLOUD_BACKUP_KEEP are removed
# only after a new one has verified.
#
# Where: PINECLOUD_BACKUP_DIR (default /opt/backups/pinecloud) on the SAME server.
# That protects against mistakes, corruption and a bad upgrade, but NOT against loss
# of the VPS; copy the directory off the server as well (see docs/automation-registry.md).
#
# Restore, in short (full steps in docs/automation-registry.md):
#   occ maintenance:mode --on; extract files.tar.gz into the volume; gunzip -c db.sql.gz |
#   mariadb -u root -p nextcloud; occ maintenance:mode --off; occ files:scan --all
#
# Run by root's crontab: 30 1 * * * (01:30 UTC = 04:30 Nairobi). Safe to run by hand.
set -euo pipefail
umask 077

BACKUP_DIR="${PINECLOUD_BACKUP_DIR:-/opt/backups/pinecloud}"
KEEP="${PINECLOUD_BACKUP_KEEP:-14}"
APP_CONTAINER="${PINECLOUD_APP_CONTAINER:-nextcloud-app}"
DB_CONTAINER="${PINECLOUD_DB_CONTAINER:-nextcloud-db}"
DATA_DIR="${PINECLOUD_DATA_DIR:-/var/lib/docker/volumes/nextcloud_nc_data/_data}"
LOCK_FILE="${PINECLOUD_LOCK_FILE:-/var/lock/pinecloud-backup.lock}"

log() { echo "[pinecloud-backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# One run at a time: a slow backup must never overlap the next scheduled one.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another backup is still running; skipping this run"
  exit 0
fi

[ -d "$DATA_DIR" ] || { log "ERROR: data directory $DATA_DIR not found"; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%d-%H%M%S)"
tmp="$BACKUP_DIR/.incomplete-$stamp"
final="$BACKUP_DIR/$stamp"
maintenance_on=0

occ() { docker exec -u www-data "$APP_CONTAINER" php occ "$@"; }

cleanup() {
  status=$?
  if [ "$maintenance_on" = 1 ]; then
    if occ maintenance:mode --off >/dev/null 2>&1; then
      log "maintenance mode off"
    else
      log "WARNING: could not turn maintenance mode off - run: docker exec -u www-data $APP_CONTAINER php occ maintenance:mode --off"
      status=1
    fi
  fi
  if [ "$status" -ne 0 ]; then
    rm -rf "$tmp"
    log "FAILED (exit $status); no backup was kept from this run"
  fi
  exit "$status"
}
trap cleanup EXIT

mkdir -p "$tmp"
log "starting; destination $final"

occ maintenance:mode --on >/dev/null
maintenance_on=1
log "maintenance mode on"

# The database password is read from the container's own environment and passed
# through MYSQL_PWD inside it, so it never appears in a process list or in this script.
docker exec "$DB_CONTAINER" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb-dump --single-transaction --routines --triggers -u root nextcloud' | gzip -6 > "$tmp/db.sql.gz"
log "database dumped"

tar --numeric-owner -C "$DATA_DIR" -czf "$tmp/files.tar.gz" .
log "files archived"

occ maintenance:mode --off >/dev/null
maintenance_on=0
log "maintenance mode off"

# Verify before keeping: both archives readable end to end, and the dump really
# contains the Nextcloud schema (an empty or truncated dump would still gunzip).
gzip -t "$tmp/db.sql.gz"
gzip -t "$tmp/files.tar.gz"
tar -tzf "$tmp/files.tar.gz" >/dev/null
tables="$(gzip -dc "$tmp/db.sql.gz" | grep -c '^CREATE TABLE' || true)"
if [ "$tables" -lt 50 ]; then
  log "ERROR: the database dump has only $tables tables - refusing to keep it"
  exit 1
fi
tar -tzf "$tmp/files.tar.gz" ./config/config.php >/dev/null

(cd "$tmp" && sha256sum db.sql.gz files.tar.gz > SHA256SUMS)
mv "$tmp" "$final"
log "OK: $(du -sh "$final" | cut -f1) kept at $final ($tables tables)"

# Keep the newest $KEEP verified backups.
count=0
for dir in $(ls -1d "$BACKUP_DIR"/[0-9]*-[0-9]* 2>/dev/null | sort -r); do
  count=$((count + 1))
  if [ "$count" -gt "$KEEP" ]; then
    rm -rf "$dir"
    log "pruned $dir"
  fi
done
log "done"
