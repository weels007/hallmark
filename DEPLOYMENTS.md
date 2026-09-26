# Deployments (studionet, wallet D:\Genlayer-project\weels\contract\wallet)

- Wallet dipakai: `cpe-deploy` (0xD0B8fFA6ea2572D2a8F16512CAbB21eCFe6ea48b) — cocok dengan `wallet/cpe-deploy.json`
- Hunter uji: `cpe-v2` (0x689759bb926e032eafb1ee986ed7a98c1496ec1c) — cocok `wallet/cpe-v2.json`
- Kontrak aktif: 0x595B17f0b0D28aBb0f9ab9818a9FE7dF7b3EF9Fd (deploy SUCCESS 20 Sep 2026, MAJORITY_AGREE; view-guard + pr_number hardening + challenge window/finalize, SHA wajib, koersi ID)
- Kontrak lama (jangan dipakai): 0x3cA04311cbC3bedBd28615c81cb61482A865A4cA (view-guard tanpa pr-hardening; 13/13 adversarial + E2E medium/50 arsip di bawah), 0x78b6123d7e5A7eb7Ce7FB69474F77bfF52C5c3Cd (pra-view-guard; happy-path + sengketa 14 Sep 2026 tetap valid sebagai arsip)
- Kontrak lama (jangan dipakai): 0x78b6123d7e5A7eb7Ce7FB69474F77bfF52C5c3Cd (pra-view-guard; happy-path + sengketa 14 Sep 2026 tetap valid sebagai arsip), 0xEab1d20766fF720d0afcb9d91b9f2380484C15df (gagal: dataclass), 0x4eBbf266F43879e89851580A72e9de270A0252Ef (wajib msg.value), 0x4f80D863F313b62a7a0DcEfb94d3DF7987ec1Ea6 (pra-batch-A), 0xa83B6bF7b4784023f3F3630B56Ed6B168e230056 (crash ID int), 0xda8F7B3A15053730FD9EC078886B7E810A4c5A5D (resolve langsung bayar, tanpa sengketa)

## Happy-path + sengketa end-to-end (KONTRAK FINAL 0x78b6…5c3Cd, 14 Sep 2026)
- Fund: cpe-v2 -> kontrak 1000 wei OK
- post_bounty (poster cpe-v2, genlayer-js, tiers 10/50/150/500, deadline 0): OK -> id "0"
- submit_work (hunter cpe-deploy, bounty 0, PR 218): OK -> id "0"
- resolve_submission 0: KONSENSUS OK -> merged true, SHA 8c899cc…, medium, payout 50, pending + challenge_ends
- challenge oleh cpe-deploy (bukan poster): OK rollback `[EXPECTED] Only poster can challenge`
- challenge oleh poster: OK veto, bounty open lagi
- submit #1 + resolve #1: konsisten medium, pending
- finalize_submission 1 oleh poster (dini): OK -> paid 50
- get_bounty 0: paid, medium, payout 50, escrowed 500
- get_reputation cpe-deploy: contributor, completed 1, medium 1, earned 50

## Happy-path lama (kontrak 0xda8F, arsip)
- Fund: cpe-v2 -> kontrak 1000 wei OK (cpe-v2 saldo 6.018 GEN)
- post_bounty (poster cpe-v2, Spoon-Knife, tiers 10/50/150/500, deadline 0): OK -> id "0"
- submit_work (hunter cpe-deploy, bounty 0, PR 6): OK -> id "0"
- resolve_submission 0: KONSENSUS OK -> merged true, severity low, payout 10
- get_bounty 0: paid, winner 0xD0B8…, final low, payout 10, escrowed 500
- get_reputation cpe-deploy: contributor, completed 1, low 1, earned 10
- Catatan: `merge_commit_sha` GitHub kosong untuk PR tua (2011) — binding SHA nonaktif fallback, severity+merged tetap konsensus.

## Hasil test batch-A
- post_bounty deadline masa lalu: OK rollback `[EXPECTED] deadline must be in the future`
- refund_expired 999: OK rollback `[EXPECTED] Bounty not found`
- sweep saldo kosong: OK rollback `[EXPECTED] Nothing to sweep`
- list_submissions(cpe-v2): OK -> []
- post_bounty tanpa dana: OK rollback `[EXPECTED] fund contract first…` (masih berlaku)

## Batch B/C
- Frontend: poll receipt per hash sampai FINALIZED (pending/confirmed/failed), seksi My submissions via `list_submissions`, link PR penuh per klaim, form deadline, seksi Stewardship (cancel/refund/sweep) + finalize/challenge.
- Hasil consensus real-chain: panel `txResult` read-back `get_submission` + `get_bounty` + deep-link `https://explorer-studio.genlayer.com/tx/{hash}`; reasoning LLM tidak ditampilkan (advisory, bukan consensus).
- `scripts/test-adversarial.ps1`: 11 PASS + 2 SKIP default (funded-path + unmerged-resolve SKIP tanpa dana/fixture); 13/13 PASS dengan dana + `-UnmergedPR`. Jalankan: `powershell -ExecutionPolicy Bypass -File scripts/test-adversarial.ps1`. Unmerged-path: `-UnmergedPR "<nomor-PR-open>"` (butuh dua wallet cpe-deploy/cpe-v2 + faucet). Script pin akun cpe-deploy sendiri; sweep-guard jalan terakhir.
- Terbukti pra-redeploy (20 Sep 2026, probe read-only): `get_bounty 0` OK, `get_bounty 999` + `get_submission 999` → raw `_InvalidInputRpcError/execution failed` (bukan `[EXPECTED]`) — inilah yang diperbaiki view-guard.

## Redeploy view-guard build (20 Sep 2026, DONE → disupersede build pr-hardening di bawah)
- Deploy: `genlayer deploy --contract contracts/future_work_bounty.py` (cpe-deploy) → tx `0x4dbf5dc4832c23ca0971bb836d29a8a42285e81127286b6c56090e56c69ae3ee`, MAJORITY_AGREE (3 agree / 2 idle pasca-kuorum).
- Alamat baru disebar ke `frontend/app.js`, `frontend/*.html`, `scripts/test-adversarial.ps1`, `README.md` + file ini; frontend rebuild.
- Sebelumnya terbukti (probe read-only): `get_bounty 0` OK, `get_bounty 999` + `get_submission 999` → raw `_InvalidInputRpcError/execution failed` — diperbaiki guard ini.
- Temuan verifikasi: `genlayer call` (CLI) tidak men-decode UserError view ke teks — guard terbukti lewat `receipt.result` base64 (`Qm91bnR5IG5vdCBmb3VuZA` = "[EXPECTED] Bounty not found"); script mencocokkan payload itu.

## Happy-path kontrak 0x3cA0…A4cA (20 Sep 2026, E2E OK, kini arsip)
- Fund: cpe-v2 -> kontrak 2000 + 1500 wei OK
- Adversarial: 13/13 PASS, 0 SKIP (dengan dana + fixture `-UnmergedPR 11245`, PR open octocat/Hello-World) — termasuk `unmerged-resolve` → `[EXPECTED] PR not merged yet`, `sweep-guard`, dan 2 view-guard via payload base64. Catatan: sweep-guard kini pin akun cpe-deploy + jalan TERAKHIR agar tidak menguras dana probe.
- E2E: post_bounty bid 3 (cpe-v2, genlayer-js, tiers 10/50/150/500) → submit_work sid 1 (cpe-deploy, PR 218) → resolve konsensus MAJORITY_AGREE 3/3: medium, payout 50, SHA 8c899cc… (konsisten dengan build lama) → finalize dini oleh poster → bounty paid, passport cpe-deploy contributor/earned 50.
- Batch-2 manual (kontrak ini): double-finalize → `Already settled`, challenge-accepted → `Only pending…`, cancel-paid → `Cannot cancel`, submit-paid → `Bounty not open`, refund-tanpa-deadline → `No deadline set`, cancel non-poster → `Only poster`, self-hunt → `poster cannot hunt`, bad-repo → `repo must be`, owner-cancel bid 0 → SUCCESS + refund.
- Temuan batch-2: CLI membuang arg string kosong (calldata 2 arg → TypeError konsensus, tanpa perubahan state) dan memaksa `' '`→`0` lolos sebagai pr_number — kontrak diperketat: `pr_number` harus positif-numerik, lalu redeploy ke 0x595B…EF9Fd.

## Kontrak final 0x595B…EF9Fd (20 Sep 2026, E2E OK)
- Deploy: tx `0xb217ae3220560c92ca16e021ed173f3e43d70f48676001f8b86207d478341d84`, MAJORITY_AGREE. Perbaikan: koersi `u256(int(x))` untuk tier+deadline (akar `AttributeError: 'str' has no attribute 'to_bytes'` dari SDK string-args).
- Terbukti via SDK persis jalur frontend: post string-args + `value` 500 (payable, tanpa pre-fund) → bid 0 record benar (tier 10/50/150/500, escrowed 500) → submit PR 218 → resolve konsensus `medium`.
- Catatan: dua transfer pre-fund (`account send` 2500 wei, 0.001 GEN) kena `CANCELED/NO_MAJORITY` (flaky validator hari itu, bukan kode) — jalur payable justru jadi alternatif yang terbukti bekerja.
- Adversarial: 13/13 PASS, 0 SKIP (dengan `-UnmergedPR 11245`).
- E2E build ini: bid 1 (SDK payable, genlayer-js) → sid 0 (cpe-deploy, PR 218) → resolve konsensus `medium`/pending. Finalize tidak dieksekusi di sini (poster = akun sekali-pakai; kode finalize identik dengan build yang sudah terbukti paid 50 di 0x3cA0).

## Hasil test sebelumnya
- list_bounties: OK -> []
- get_reputation(cpe-v2): OK -> novice
- submit_work bounty 999: OK rollback `[EXPECTED] Bounty not found`
- cancel_bounty 999: OK rollback `[EXPECTED] Bounty not found`

## Blocker happy-path
Wallet + kontrak saldo 0. Studionet gasless untuk gas, tapi escrow butuh saldo.
Langkah: buka Studio (studio.genlayer.com) -> faucet droplet untuk 0xD0B8... lalu:
  genlayer account send 0xda8F7B3A15053730FD9EC078886B7E810A4c5A5D 1000gen
lalu (perhatikan argumen deadline baru, 0 = tanpa deadline):
  genlayer write 0xda8F... post_bounty --args "octocat/Hello-World" "Fix typo" "Fix README typo" 10 50 150 500 0
  genlayer account use cpe-v2
  genlayer write 0xda8F... submit_work --args "0" "1" "PR fix"
  genlayer write 0xda8F... resolve_submission --args "0"
