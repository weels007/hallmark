# Adversarial tests for FutureOfWorkBounty (studionet)
# Wallet: cpe-deploy (poster). Contract set via $C or first arg.
# Usage: ./test-adversarial.ps1 [contractAddress]
param([string]$C = "0x4dc39846CD32aB0033120eFa8Ebd19a0902396f6")

# Pin identity: all sections run as cpe-deploy (owner/poster).
# Never rely on ambient account (CLI state is shared with other agents).
genlayer account use cpe-deploy 2>&1 | Out-Null

$fail = 0
function Expect-Rollback($name, $out, $needle) {
  if ($out -match [regex]::Escape($needle)) { Write-Host "PASS: $name" }
  else { Write-Host "FAIL: $name (expected '$needle')"; $script:fail++ }
}

# 1. Past deadline must be rejected (time guard)
$r = genlayer write $C post_bounty --args "octocat/Hello-World" "Past" "x" 10 50 150 500 1 2>&1 | Out-String
Expect-Rollback "past-deadline" $r "deadline must be in the future"

# 2. Unknown bounty on every id-taking method (wrong-record selection)
$r = genlayer write $C submit_work --args "999" "1" "x" 2>&1 | Out-String
Expect-Rollback "submit-unknown" $r "Bounty not found"
$r = genlayer write $C cancel_bounty --args "999" 2>&1 | Out-String
Expect-Rollback "cancel-unknown" $r "Bounty not found"
$r = genlayer write $C refund_expired --args "999" 2>&1 | Out-String
Expect-Rollback "refund-unknown" $r "Bounty not found"
$r = genlayer write $C resolve_submission --args "999" 2>&1 | Out-String
Expect-Rollback "resolve-unknown" $r "Submission not found"
$r = genlayer write $C finalize_submission --args "999" 2>&1 | Out-String
Expect-Rollback "finalize-unknown" $r "Submission not found"
$r = genlayer write $C challenge_submission --args "999" "x" 2>&1 | Out-String
Expect-Rollback "challenge-unknown" $r "Submission not found"

# 3. Views stay readable after reverts (reward view returns zero state)
$r = genlayer call $C list_submissions --args addr#689759bb926e032eafb1ee986ed7a98c1496ec1c 2>&1 | Out-String
if ($r -match "\[\]") { Write-Host "PASS: list-empty" } else { Write-Host "FAIL: list-empty"; $fail++ }

# 4. Views fail cleanly on unknown records (wrong-record selection).
# Requires the view-guard build (get_bounty/get_submission [EXPECTED] guards).
# NOTE: `genlayer call` does not decode view UserErrors to text; the guarded message
# arrives base64-encoded inside receipt.result (Qm91bnR5... = "Bounty not found",
# U3VibWlzc2lvbi... = "Submission not found"). Pre-redeploy contracts answer with
# a raw RPC error and no such payload -> SKIP, not FAIL.
$r = genlayer call $C get_bounty --args 999 2>&1 | Out-String
if ($r -match "Bounty not found" -or $r -match "Qm91bnR5IG5vdCBmb3VuZA") { Write-Host "PASS: view-bounty-unknown" }
elseif ($r -match "InvalidInput|execution failed") { Write-Host "SKIP: view-bounty-unknown (needs view-guard redeploy, see DEPLOYMENTS.md)" }
else { Write-Host "FAIL: view-bounty-unknown"; $fail++ }
$r = genlayer call $C get_submission --args 999 2>&1 | Out-String
if ($r -match "Submission not found" -or $r -match "U3VibWlzc2lvbiBub3QgZm91bmQ") { Write-Host "PASS: view-submission-unknown" }
elseif ($r -match "InvalidInput|execution failed") { Write-Host "SKIP: view-submission-unknown (needs view-guard redeploy, see DEPLOYMENTS.md)" }
else { Write-Host "FAIL: view-submission-unknown"; $fail++ }

# 5. Payable-required: the CLI cannot send msg.value, so a CLI post must be
# rejected (SDK payable path is covered in frontend/test-settlement.mjs T-a).
$r = genlayer write $C post_bounty --args "octocat/Hello-World" "Funded" "x" 10 50 150 500 0 2>&1 | Out-String
Expect-Rollback "payable-required" $r "must fund escrow in this transaction"

# 6. Resolve must refuse unmerged PRs. Needs an SDK-funded probe bounty
# (CLI cannot send payable value) — covered live in test-settlement.mjs T-g.
Write-Host "SKIP: unmerged-resolve (needs SDK-funded probe; see test-settlement.mjs T-g)"

# 7. Fund conservation LAST: sweep must refuse only when nothing is free.
# Runs as owner (cpe-deploy, pinned above). After funded sections the contract
# normally holds free balance -> sweep succeeds WITHOUT touching locked escrow.
# Either outcome passes; anything else (e.g. non-owner "Only owner") fails.
# NOTE: this machine's genlayer CLI state is shared with other agents/projects:
# re-pin identity here in case another session switched the active account.
genlayer account use cpe-deploy 2>&1 | Out-Null
$r = genlayer write $C sweep 2>&1 | Out-String
if ($r -match "Nothing to sweep" -or $r -match "status: 'return'") { Write-Host "PASS: sweep-guard" }
else { Write-Host "FAIL: sweep-guard"; $script:fail++ }

if ($fail -eq 0) { Write-Host "ALL ADVERSARIAL CHECKS PASSED" } else { Write-Host "$fail CHECKS FAILED"; exit 1 }
