# PineCloud (Nextcloud at files.pinefrostdb.com)

Self-hosted team file share. It runs beside the dashboard on the same VPS but is
independent of it: separate containers, separate MariaDB, nothing in the dashboard
reads or writes it. Its Caddy block lives in the repo `Caddyfile` and must be kept
whenever the dashboard is released; its compose file lives **only on the VPS** at
`/opt/nextcloud/docker-compose.yml` (with `/opt/nextcloud/.env`, which holds secrets and
must not be copied into the repo).

| Item | Value |
| --- | --- |
| Containers | `nextcloud-app` (`nextcloud:29-apache`), `nextcloud-db` (`mariadb:11`), `nextcloud-redis` (`redis:7-alpine`) |
| Data | Docker volumes `nextcloud_nc_data` (= `/var/www/html`: files, `config/config.php`, apps) and `nextcloud_db_data` |
| Network | `pinefrost_default`; no published ports, reached only through Caddy |
| Version | 29.0.16. The image is pinned to major 29; Nextcloud only upgrades one major version at a time (29, 30, 31, ...) and a backup must be taken first |
| Accounts | `admin` (default install account) and `analytics@pinefrost.co.ke` (super admin; can create users and reset their passwords from Users). Two-factor is installed but not enforced; no outgoing mail is configured, so password resets are done by an admin, not by email |

## Background jobs

Nextcloud runs in **cron mode**. Root's crontab on the VPS runs

```
*/5 * * * * docker exec -u www-data nextcloud-app php -f /var/www/html/cron.php
```

Without it Nextcloud falls back to running jobs during page loads and, if nobody visits,
not at all (trash and version cleanup, share expiry, notifications and file scanning
silently stop). Check: **Administration settings > Overview** shows "Cron last run:
seconds ago", or `docker exec -u www-data nextcloud-app php occ setupchecks`.

## Nightly backup

`scripts/pinecloud/backup.sh` is installed at `/opt/nextcloud/backup.sh` and run by root's
crontab at **01:30 UTC (04:30 Nairobi)**, logging to `/var/log/pinecloud-backup.log`.

- Puts Nextcloud in maintenance mode for about 30 seconds (always taken out again, even on
  failure), dumps the database, archives the whole data volume, then verifies both archives
  and that the dump contains the Nextcloud schema before keeping anything.
- Keeps the newest **14** verified backups in `/opt/backups/pinecloud/<UTC timestamp>/`
  (`db.sql.gz`, `files.tar.gz`, `SHA256SUMS`), about 370 MB each at the time of writing.
  Directory mode 700: the archive contains `config.php`.
- A failed run leaves no partial backup and exits non-zero. **No alert is wired to it yet**;
  look at the log, or at `ls /opt/backups/pinecloud` (the newest folder should be under a day old).
- **Same-server only.** It protects against mistakes, corruption and a bad upgrade, not
  against losing the VPS. Pulling `/opt/backups/pinecloud` to another machine (for example
  the download machine, over the existing SSH key) is the open follow-up.

### Restore

Proven on 2026-10-07 by loading a backup into a throwaway MariaDB container: all 103
tables, identical file-cache row count and archive entry count to the live instance.

```bash
B=/opt/backups/pinecloud/<timestamp>
cd $B && sha256sum -c SHA256SUMS                      # both files must say OK
docker exec -u www-data nextcloud-app php occ maintenance:mode --on
# files: replace the volume contents with the archive
tar --numeric-owner -xzf $B/files.tar.gz -C /var/lib/docker/volumes/nextcloud_nc_data/_data
# database: load into the (emptied) nextcloud database
gzip -dc $B/db.sql.gz | docker exec -i nextcloud-db sh -c 'MYSQL_PWD=$MYSQL_ROOT_PASSWORD mariadb -u root nextcloud'
docker exec -u www-data nextcloud-app php occ maintenance:mode --off
docker exec -u www-data nextcloud-app php occ files:scan --all
```

To rebuild on a new server, start the stack from `/opt/nextcloud/docker-compose.yml` (same
image tags), then restore as above before first use.

## Known open items

- HSTS header is not set (Nextcloud's own check warns); it can be added in the `files.pinefrostdb.com`
  block of the `Caddyfile`.
- No maintenance window configured (`maintenance_window_start`); heavy daily jobs can run in office hours.
- The Apache/PHP versions are visible in response headers (`Server`, `X-Powered-By`).
- `/opt/nextcloud/.env` is world-readable (mode 644); it should be 600.
- Nextcloud 29 is an older major version and should be upgraded (see Version above).
