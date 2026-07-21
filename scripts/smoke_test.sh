#!/bin/sh

set -eu

base_url="${1:-https://campusgamingnetwork.com}"
base_url="${base_url%/}"

check() {
  path="$1"
  label="$2"
  status="$(curl --silent --show-error --location --connect-timeout 10 --max-time 30 --output /dev/null --write-out '%{http_code}' "${base_url}${path}")"
  if [ "$status" != "200" ]; then
    echo "FAIL ${label}: ${base_url}${path} returned HTTP ${status}" >&2
    exit 1
  fi
  echo "PASS ${label}: ${base_url}${path}"
}

check "/" "homepage"
check "/api/health" "web and private API health"
check "/schools" "school directory"
check "/events" "event directory"
check "/teams" "team directory"

echo "Automated public smoke checks passed. Complete the authenticated checklist in docs/13-deployment-plan.md."
