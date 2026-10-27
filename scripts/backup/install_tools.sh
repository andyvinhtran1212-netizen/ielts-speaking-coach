#!/usr/bin/env bash
# Install the client tools the offsite backup/drill jobs need on an Ubuntu
# GitHub runner. pg_dump must be at least the server's major version
# (Supabase runs PostgreSQL 17), and psql >= 17.6 understands the \restrict
# lines that current pg_dumpall writes. The AWS CLI is preinstalled.
set -euo pipefail
PG_MAJOR="${PG_MAJOR:-17}"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo -E apt-get install -y -qq postgresql-common age > /dev/null
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y > /dev/null
sudo -E apt-get install -y -qq "postgresql-client-$PG_MAJOR" > /dev/null
echo "/usr/lib/postgresql/$PG_MAJOR/bin" >> "${GITHUB_PATH:-/dev/null}"
"/usr/lib/postgresql/$PG_MAJOR/bin/pg_dump" --version
age --version
aws --version
