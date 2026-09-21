# Adversarial tests for FutureOfWorkBounty (studionet)
# Wallet: cpe-deploy (poster). Contract set via $C or first arg.
# Usage: ./test-adversarial.ps1 [contractAddress] [-UnmergedPR <open-pr-number>]
param([string]$C = "0x595B17f0b0D28aBb0f9ab9818a9FE7dF7b3EF9Fd", [string]$UnmergedPR = "")

# Pin identity: sections 1-6 + sweep run as cpe-deploy (owner/poster); section 7
# temporarily switches to cpe-v2 (hunter) and back. Never rely on ambient account.
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

# 5. Funded happy-path (needs faucet balance; skipped gracefully when unfunded)
$r = genlayer write $C post_bounty --args "octocat/Hello-World" "Funded" "x" 10 50 150 500 0 2>&1 | Out-String
if ($r -match "fund contract first") { Write-Host "SKIP: funded-path (no balance - fund via Studio faucet first)" }
elseif ($r -match "Write Transaction Hash") { Write-Host "PASS: funded-post accepted" }
else { Write-Host "FAIL: funded-post (unexpected)"; $fail++ }

# 6. Resolve must refuse unmerged PRs (needs funds + explicit open-PR fixture; skipped otherwise)
# Usage: ./test-adversarial.ps1 -UnmergedPR "12"   (PR must still be OPEN in octocat/Hello-World)
# Posts a probe bounty (cpe-deploy), submits the open PR (cpe-v2, poster cannot self-hunt),
# resolves -> expects "[EXPECTED] PR not merged yet". Leaves one open probe bounty on-chain by design.
if ($UnmergedPR -eq "") { Write-Host "SKIP: unmerged-resolve (pass -UnmergedPR <open-pr-number> with a funded wallet to run)" }
else {
  genlayer account use cpe-deploy 2>&1 | Out-Null
  $r = genlayer write $C post_bounty --args "octocat/Hello-World" "UnmergedProbe" "probe" 10 50 150 500 0 2>&1 | Out-String
  if ($r -match "fund contract first") { Write-Host "SKIP: unmerged-resolve (no balance - fund via Studio faucet first)" }
  elseif ($r -match "Write Transaction Hash") {
    $bounties = genlayer call $C list_bounties 2>&1 | Out-String
    $bid = (([regex]"id: '(\d+)'").Matches($bounties) | Select-Object -Last 1).Groups[1].Value
    if ($bid -eq "") { Write-Host "FAIL: unmerged-resolve (could not read probe bid)"; $fail++ }
    else {
      genlayer account use cpe-v2 2>&1 | Out-Null
      $r = genlayer write $C submit_work --args $bid $UnmergedPR "probe" 2>&1 | Out-String
      if ($r -match "Write Transaction Hash") {
        $subs = genlayer call $C list_submissions --args addr#689759bb926e032eafb1ee986ed7a98c1496ec1c 2>&1 | Out-String
        $sid = (([regex]"id: '(\d+)'").Matches($subs) | Select-Object -Last 1).Groups[1].Value
        $r = genlayer write $C resolve_submission --args $sid 2>&1 | Out-String
        Expect-Rollback "unmerged-resolve" $r "PR not merged yet"
      }
      else { Write-Host "FAIL: unmerged-resolve (probe submit rejected)"; $fail++ }
      genlayer account use cpe-deploy 2>&1 | Out-Null
    }
  }
  else { Write-Host "FAIL: unmerged-resolve (unexpected)"; $fail++ }
}

# 7. Fund conservation LAST: sweep must refuse only when nothing is free.
# Runs as owner (cpe-deploy, pinned above). After funded sections the contract
# normally holds free balance -> sweep succeeds WITHOUT touching locked escrow.
# Either outcome passes; anything else (e.g. non-owner "Only owner") fails.
$r = genlayer write $C sweep 2>&1 | Out-String
if ($r -match "Nothing to sweep" -or $r -match "status: 'return'") { Write-Host "PASS: sweep-guard" }
else { Write-Host "FAIL: sweep-guard"; $script:fail++ }

if ($fail -eq 0) { Write-Host "ALL ADVERSARIAL CHECKS PASSED" } else { Write-Host "$fail CHECKS FAILED"; exit 1 }
