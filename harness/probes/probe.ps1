<#
.SYNOPSIS
  NOVA STUDIO harness probe. Runs verifiable checks per scope and prints a PASS/FAIL summary.
  Usage: pwsh harness/probes/probe.ps1 -Scope <all|infra|shared|api|editor-core|realtime|web|e2e|security|perf|deploy|gate-m1|gate-m2>
  Agents MUST NOT add skip flags or weaken checks here (see .agents/rules/00-harness-loop.md).
#>
param([Parameter(Mandatory = $true)][string]$Scope)

$ErrorActionPreference = 'Continue'
$results = [System.Collections.Generic.List[object]]::new()

function Step([string]$name, [scriptblock]$cmd) {
  Write-Host "`n=== $name ===" -ForegroundColor Cyan
  & $cmd
  $ok = ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE)
  $results.Add([pscustomobject]@{ Step = $name; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }) })
  $global:LASTEXITCODE = 0
}

function Guard-NoCheats {
  Step 'guard: no .only/.skip/waitForTimeout' {
    $hits = Get-ChildItem -Recurse -Include *.ts, *.tsx -Path apps, packages -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch 'node_modules|dist|\.next' } |
      Select-String -Pattern '\b(it|test|describe)\.(only|skip)\(|waitForTimeout\(' -ErrorAction SilentlyContinue
    if ($hits) { $hits | ForEach-Object { Write-Host $_ }; $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 }
  }
  Step 'guard: editor-core headless' {
    $hits = Get-ChildItem -Recurse -Include *.ts -Path packages/editor-core/src -ErrorAction SilentlyContinue |
      Select-String -Pattern "from ['""](react|konva|react-konva|next)|\bwindow\.|\bdocument\." -ErrorAction SilentlyContinue
    if ($hits) { $hits | ForEach-Object { Write-Host $_ }; $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 }
  }
}

function Base {
  Step 'lint' { pnpm lint }
  Step 'typecheck' { pnpm typecheck }
  Guard-NoCheats
}

switch ($Scope) {
  'all'         { Base; Step 'test (all)' { pnpm test }; Step 'build' { pnpm build } }
  'infra'       { Step 'compose up' { docker compose -f infra/docker-compose.dev.yml up -d --wait } }
  'shared'      { Base; Step 'test shared' { pnpm --filter @nova/shared test -- --coverage } }
  'api'         { Base; Step 'test api unit' { pnpm --filter api test }; Step 'test api e2e' { pnpm --filter api test:e2e } }
  'editor-core' { Base; Step 'test editor-core' { pnpm --filter @nova/editor-core test -- --coverage } }
  'realtime'    { Base; Step 'test realtime' { pnpm --filter realtime test } }
  'web'         { Base; Step 'test web unit' { pnpm --filter web test }; Step 'playwright' { pnpm --filter web e2e } }
  'e2e'         { Base; Step 'playwright evals' { pnpm --filter web e2e:evals } }
  'security'    { Base; Step 'pnpm audit' { pnpm audit --prod --audit-level high }; Step 'gitleaks' { gitleaks detect --no-banner } }
  'perf'        { Step 'bench editor-core' { pnpm --filter @nova/editor-core bench }; Step 'eval E12' { pnpm --filter web e2e:evals --grep E12 } }
  'deploy'      { Step 'prod compose' { docker compose -f infra/docker-compose.prod.yml up -d --build --wait }; Step 'health' { curl.exe -fsS http://localhost/api/v1/health } }
  'gate-m1'     { Base; Step 'test (all)' { pnpm test }; Step 'evals E1-E5' { pnpm --filter web e2e:evals --grep "E[1-5]\b" } }
  'gate-m2'     { Base; Step 'test (all)' { pnpm test }; Step 'evals all' { pnpm --filter web e2e:evals }; Step 'audit' { pnpm audit --prod --audit-level high } }
  default       { Write-Host "Unknown scope: $Scope"; exit 2 }
}

Write-Host "`n===== PROBE SUMMARY ($Scope) =====" -ForegroundColor Yellow
$results | Format-Table -AutoSize | Out-String | Write-Host
$failed = @($results | Where-Object Result -eq 'FAIL').Count
if ($failed -gt 0) { Write-Host "PROBE FAIL: $failed step(s) failed" -ForegroundColor Red; exit 1 }
Write-Host "PROBE PASS: $($results.Count) step(s)" -ForegroundColor Green
exit 0
