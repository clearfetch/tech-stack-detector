#!/usr/bin/env bash
# Refreshes the fingerprint database from the open-source webappanalyzer project (GPL-3.0).
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="https://raw.githubusercontent.com/enthec/webappanalyzer/main/src"
for f in _ a b c d e f g h i j k l m n o p q r s t u v w x y z; do
  curl -sfL -o "data/technologies/$f.json" "$BASE/technologies/$f.json"
done
curl -sfL -o data/categories.json "$BASE/categories.json"
echo "updated $(date -u +%F)" > data/UPDATED
