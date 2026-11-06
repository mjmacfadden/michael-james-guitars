#!/usr/bin/env bash
# Stores the restricted TEST key from $MJG_STRIPE_TEST_SECRET_KEY into Secret Manager as STRIPE_SECRET_KEY.
# Never echoes the value; passes it via stdin (not argv); refuses anything but rk_test_.
set -euo pipefail
set +x
: "${MJG_STRIPE_TEST_SECRET_KEY:?MJG_STRIPE_TEST_SECRET_KEY not set}"
if [[ ! "$MJG_STRIPE_TEST_SECRET_KEY" =~ ^rk_test_[A-Za-z0-9]{20,}$ ]]; then
  echo "refused: expected a restricted TEST key (rk_test_...)" >&2; exit 2
fi
cd "$(dirname "$0")/.."
printf '%s' "$MJG_STRIPE_TEST_SECRET_KEY" | npx -y firebase-tools@latest functions:secrets:set STRIPE_SECRET_KEY \
  --data-file - --project michael-james-guitars --non-interactive 2>&1 | sed -E 's/(rk|sk)_(test|live)_[A-Za-z0-9]+/REDACTED/g'
