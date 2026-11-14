#!/usr/bin/env bash
# NOVA STUDIO harness probe (POSIX). Usage: harness/probes/probe.sh <scope>
# Agents MUST NOT add skip flags or weaken checks here.
set -u
SCOPE="${1:?scope required}"
FAILS=0; TOTAL=0
step() { local name="$1"; shift; echo; echo "=== $name ==="; TOTAL=$((TOTAL+1)); if "$@"; then echo "[PASS] $name"; else echo "[FAIL] $name"; FAILS=$((FAILS+1)); fi; }
guard() {
  step "guard: no .only/.skip/waitForTimeout" bash -c '! grep -rEn --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next "\b(it|test|describe)\.(only|skip)\(|waitForTimeout\(" apps packages 2>/dev/null'
  step "guard: editor-core headless" bash -c '! grep -rEn --include=*.ts "from [\"'"'"'](react|konva|react-konva|next)|\bwindow\.|\bdocument\." packages/editor-core/src 2>/dev/null'
}
base() { step lint pnpm lint; step typecheck pnpm typecheck; guard; }
case "$SCOPE" in
  all) base; step test pnpm test; step build pnpm build ;;
  infra) step compose docker compose -f infra/docker-compose.dev.yml up -d --wait ;;
  shared) base; step test pnpm --filter @nova/shared test -- --coverage ;;
  api) base; step unit pnpm --filter api test; step e2e pnpm --filter api test:e2e ;;
  editor-core) base; step test pnpm --filter @nova/editor-core test -- --coverage ;;
  realtime) base; step test pnpm --filter realtime test ;;
  web) base; step unit pnpm --filter web test; step playwright pnpm --filter web e2e ;;
  e2e) base; step evals pnpm --filter web e2e:evals ;;
  security) base; step audit pnpm audit --prod --audit-level high; step gitleaks gitleaks detect --no-banner ;;
  perf) step bench pnpm --filter @nova/editor-core bench; step E12 pnpm --filter web e2e:evals --grep E12 ;;
  deploy) step prod docker compose -f infra/docker-compose.prod.yml up -d --build --wait; step health curl -fsS http://localhost/api/v1/health ;;
  gate-m1) base; step test pnpm test; step evals pnpm --filter web e2e:evals --grep "E[1-5]\b" ;;
  gate-m2) base; step test pnpm test; step evals pnpm --filter web e2e:evals; step audit pnpm audit --prod --audit-level high ;;
  *) echo "Unknown scope: $SCOPE"; exit 2 ;;
esac
echo; echo "===== PROBE SUMMARY ($SCOPE): $((TOTAL-FAILS))/$TOTAL passed ====="
[ "$FAILS" -eq 0 ] && echo "PROBE PASS" || { echo "PROBE FAIL"; exit 1; }
