# Hallmark — Future of Work · Automated Bug Bounties

> Work verified by consensus, paid on outcome, with portable reputation.

**Live (GenLayer studionet):** `0xfe57D304623471A6aB8db137d73D2766b610eEA5`
· [Studio Explorer](https://explorer-studio.genlayer.com) · [Protocol](./frontend/how.html) · [App](./frontend/app.html)

| | |
|---|---|
| Contract | `contracts/future_work_bounty.py` (GenLayer intelligent contract) |
| Frontend | `frontend/` — landing, protocol, bounty workbench (Vite + `genlayer-js`) |
| Tests | `scripts/test-adversarial.ps1` — **13/13 PASS**, 0 SKIP (funded + fixture) |
| E2E | Post → submit PR #218 → resolve `medium`/50 → finalize `paid`, passport `contributor` |

## How it works

1. **Post** — `post_bounty(repo, title, description, low, med, high, crit, deadline)` mengunci escrow max (`crit`). `deadline` unix detik, `0` = tanpa batas.
2. **Submit** — `submit_work(bounty_id, pr_number, notes)` menautkan PR GitHub. Poster tidak bisa hunt bounty sendiri; `pr_number` harus positif-numerik; URL PR disimpan di submission.
3. **Resolve** — `resolve_submission(submission_id)`: satu ronde konsensus fetch PR + patch, pastikan `merged=true` dan SHA ada, LLM beri tier. Validator sepakat atas `merged`, `merge_commit_sha`, `severity` → status `pending` + jendela sengketa 3 hari.
4. **Challenge / Finalize** — `challenge_submission` (poster saja + alasan tercatat) → veto, bounty dibuka lagi. `finalize_submission` (poster kapan pun, pihak lain pasca-jendela) → payout hunter, sisa refund, bounty `paid`, passport naik tingkat.
5. **Escape** — `cancel_bounty` (poster/owner pre-resolve), `refund_expired` (siapa pun pasca-deadline), `sweep` (owner, hanya saldo di luar escrow).

Tier default (wei): `low=10 · medium=50 · high=150 · critical=500`.

## Consensus design

- Satu blok `run_nondet_unsafe`: fetch PR + patch → LLM grade → return terstruktur. Storage write & pesan dana selalu di luar blok.
- Validator bandingkan field keputusan saja (`merged`, `sha`, `severity`); reasoning advisory, tidak disimpan, tidak dipakai banding.
- Error prefix: `[EXPECTED]`/`[EXTERNAL]` harus sama persis, `[TRANSIENT]` sepakat bila sama-sama transient, `[LLM_ERROR]` selalu disagree → rotasi validator.

## Proven on-chain (studionet, 20 Sep 2026)

- Fund 2500 wei → post (genlayer-js) → submit PR #218 (merged, SHA `8c899cc…`) → resolve konsensus `MAJORITY_AGREE`: `medium`, payout 50 → finalize poster → `paid`, passport `contributor`/earned 50.
- Adversarial 13/13: past-deadline, 6× unknown-record write, sweep-guard, list-empty, 2× view-guard, funded-post, unmerged-resolve (`[EXPECTED] PR not merged yet`, fixture PR open #11245).
- Batch-2 manual: double-finalize, challenge-accepted, cancel-paid, submit-paid, refund-tanpa-deadline, cancel non-poster, self-hunt, bad-repo, owner-cancel + refund — semua menolak/berhasil sesuai desain.
- Riwayat lengkap (termasuk arsip kontrak lama): [`DEPLOYMENTS.md`](./DEPLOYMENTS.md).

## Frontend (`frontend/`)

```bash
cd frontend && npm install && npm run dev   # dev di :5173
npm run build                               # output dist/
```

- `/` landing · `/how.html` protokol + fund-safety · `/app.html` ledger, post/submit/resolve, passport, my-submissions.
- Tiap write menunggu receipt `FINALIZED` per hash; panel hasil baca-balik `get_submission` + `get_bounty` dari chain + deep-link `explorer-studio.genlayer.com/tx/{hash}`.

## Batasan jujur

- CLI tidak mendukung `--value`: escrow lewat pre-fund `account send` (JS SDK mendukung payable langsung).
- PR tanpa `merge_commit_sha` (sangat tua) → resolve MENOLAK (`[EXPECTED] No merge SHA`), karena payout tanpa binding SHA tidak dapat dipertahankan.
- Resolve permissionless demi liveness; self-deal diblokir di kontrak.
- Sengketa asimetris by design: hanya poster bisa veto; hunter resubmit pasca-veto. Veto membuka ulang bounty (bukan merampas dana), dan finalisasi permissionless pasca-jendela menyeimbangkan.
- `genlayer call` (CLI) tidak men-decode UserError view ke teks — guard terbukti via payload base64 di receipt (terdokumentasi di `DEPLOYMENTS.md`).
