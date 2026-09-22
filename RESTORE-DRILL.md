# Restore drill

Date: 2026-09-22
Command: `bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh`
Dump: `backups/marketplace-2026-09-22_144930.dump`, created by `scripts/backup.sh` through PgBouncer
Dump size: 20973 bytes
Restore target: a new `postgres:17` container with an empty volume, created and removed by the script
Result: MATCH

Control values, source vs restored:

```text
tables: jobs=82,migrations=2,order_items=52,orders=47,products=8,typeorm_metadata=1,users=57
orders: 47|26094600  (count | sum(total) in kopiykas)
```

## RTO

Measured `pg_restore` time: 1 second for a 20973-byte dump.
Measured end-to-end drill time, from container start to MATCH: about 5 seconds.
RTO on this data set: under 1 minute. It grows with the dump size; re-measure after the data grows.

## RPO

Backups run once a night at 03:00, see `backup.cron`.
RPO: up to 24 hours. A failure at 02:59 loses almost a full day of writes. Reducing it needs more frequent dumps or WAL archiving.
