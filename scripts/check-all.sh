#!/usr/bin/env bash
# Confere se TODOS os módulos compilam. Rode antes de entregar.
set -e
cd "$(dirname "$0")/.."
for d in services/* gateway; do
  echo "==> $d"
  (cd "$d" && npm ci --silent && npm run build --silent)
done
echo "TUDO COMPILA"
