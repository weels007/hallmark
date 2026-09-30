# Deployments (studionet, wallet D:\Genlayer-project\weels\contract\wallet)

- Wallet dipakai: `cpe-deploy` (0xD0B8fFA6ea2572D2a8F16512CAbB21eCFe6ea48b) — cocok dengan `wallet/cpe-deploy.json`
- Hunter uji: `cpe-v2` (0x689759bb926e032eafb1ee986ed7a98c1496ec1c) — cocok `wallet/cpe-v2.json`
- Kontrak aktif: 0x4dc39846CD32aB0033120eFa8Ebd19a0902396f6 (deploy SUCCESS, MAJORITY_AGREE, deployer terverifikasi cpe-deploy; steward settlement build: payable funding, ordered tiers, no-duplicate, no-post-deadline, PR-postdates, veto-blocks-reclaim)
- Kontrak lama (jangan dipakai): 0x70964619D06d71683fF82c47F944A9E123AD7529 (kode benar — T1/T2 deadline-proof valid di sini — tapi OWNER jatuh ke wallet asing `stratasure-deploy` karena akun CLI aktif diganti agent lain saat deploy; sweep/owner-cancel di luar tangan kami, escrow T1 500 wei terkunci), 0xFB1a576cDC1caD7bFD59900097eb335AF4b7DD91 (Address-coercion; string-views + resolve medium)
- Kontrak lama (jangan dipakai): 0x595B17f0b0D28aBb0f9ab9818a9FE7dF7b3EF9Fd (u256-fix; string-post + resolve medium), 0x3cA04311cbC3bedBd28615c81cb61482A865A4cA (13/13 adversarial + E2E medium/50), 0x78b6123d7e5A7eb7Ce7FB69474F77bfF52C5c3Cd (pra-view-guard; happy-path + sengketa 14 Sep 2026 tetap valid sebagai arsip)
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
- Temuan batch-2: CLI membuang arg string kosong (calldata 2 arg → TypeError konsensus, tanpa perubahan state) dan memaksa `' '`→`0` lolos sebagai pr_number — kontrak diperketat: `pr_number` harus positif-numerik, lalu redeploy ke 0x4dc3…396f6.

## Kontrak final 0x4dc3…396f6 (live — steward settlement build)
- Deploy: tx `0x0721fb497a0d035e5a58fff55e583098b0bf14b7f4d6af9a9466e69e0efa6a86`, MAJORITY_AGREE, deployer = cpe-deploy terverifikasi via receipt.
- Settlement suite (`frontend/test-settlement.mjs`): **9/9 PASS** — fund-from-posting-tx, tiers-recorded, tier-zero, tier-unordered, underfunded-post, duplicate-claim, post-deadline-claim, predates-bounty (konsensus berjalan + validator sepakat atas merged_at), unmerged-resolve.
- Adversarial ps1: 12 PASS + 1 SKIP (unmerged via mjs; CLI didokumentasikan butuh payable).
- Deadline guards + veto mechanics + E2E paid: kode identik, terbukti live di arsip (T1/T2 di 0x7096; 13/13 + paid 50 di 0x3cA0).
- Batasan bukti (jujur): `challenge→cancel-block` dan `veto→refund-block` belum dieksekusi live — butuh submission pending (= butuh PR fresh-merged, tanpa fixture saat ini). Guard 3 baris mengikuti pola terbukti; verifikasi ulang saat fixture tersedia.
- STANDING BY di kontrak ini: bid 7 `Veto-standby studio` (open, `genlayerlabs/genlayer-studio`, created_at `1790747730`, poster key `%TEMP%/hallmark_veto_poster_7.key`). Begitu ada PR studio merged dengan `merged_at` lebih baru: `node frontend/veto-proof.mjs 7 <nomor-PR>` — submit → resolve → veto → cancel-ditolak (`must be re-resolved`) → resubmit → resolve → finalize → paid. (Bid 5/6 genlayer-js: tanpa merge baru; key bid 6 di `hallmark_veto_poster.key`.)
- Arsip: 0xADa5 (E2E hijau penuh SDK-only: paid 50 + passport), 0x7096 (T1/T2 valid; owner jatuh ke asing), 0xFB1a (Address-coercion), 0x595B (u256-fix), 0x3cA0 (13/13 + paid 50), 0x78b6 (14 Sep).

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
