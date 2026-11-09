#!/usr/bin/env bash
# Backup consistente do SQLite (online) — agende no cron diariamente.
# Uso: deploy/backup.sh /var/lib/verum-lives /var/backups/verum-lives
set -euo pipefail
SRC="${1:-/var/lib/verum-lives}"
DEST="${2:-/var/backups/verum-lives}"
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M%S)
node --disable-warning=ExperimentalWarning -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1]);
db.exec(\"VACUUM INTO '\" + process.argv[2].replace(/'/g, \"''\") + \"'\");
" "$SRC/verum-lives.sqlite" "$DEST/verum-lives-$STAMP.sqlite"
chmod 600 "$DEST/verum-lives-$STAMP.sqlite"
find "$DEST" -name 'verum-lives-*.sqlite' -mtime +30 -delete
echo "Backup: $DEST/verum-lives-$STAMP.sqlite (os dados pessoais seguem criptografados; guarde as chaves do .env separadamente)"
