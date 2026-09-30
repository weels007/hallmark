// Veto-block proof runner (steward settlement, final mile).
// The PR must be merged AFTER the bounty's created_at (postdates rule).
// Usage: node frontend/veto-proof.mjs <bid> <fresh-merged-pr-number>
// Poster key: %TEMP%/hallmark_veto_poster_<bid>.key (created by standby-post.mjs).
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import fs from "fs";

const [BID, PR] = process.argv.slice(2);
if (!/^\d+$/.test(BID || "") || !/^[1-9][0-9]*$/.test(PR || "")) {
  console.error("Usage: node frontend/veto-proof.mjs <bid> <fresh-merged-pr-number>");
  process.exit(2);
}

const C = "0x4dc39846CD32aB0033120eFa8Ebd19a0902396f6";
const KEYFILE = `${process.env.TEMP}/hallmark_veto_poster_${BID}.key`;
const c = createClient({ chain: studionet });
const poster = createAccount(fs.readFileSync(KEYFILE, "utf8").trim());
const hunter = createAccount();
let pass = 0, fail = 0;

async function write(fn, args, account, value = 0n) {
  const h = await c.writeContract({ address: C, functionName: fn, args, value, account });
  await c.waitForTransactionReceipt({ hash: h, status: "ACCEPTED" });
  return h;
}
async function expectRollback(label, hash, needle) {
  const t = await c.getTransaction({ hash });
  const p = JSON.stringify(t?.consensus_data?.leader_receipt?.[0]?.result ?? "");
  if (p.includes(needle)) { console.log(`PASS: ${label}`); pass++; }
  else { console.log(`FAIL: ${label} (missing '${needle}')`); fail++; }
}

// 1. submit + resolve -> pending (fresh PR satisfies postdates rule).
await write("submit_work", [BID, PR, "veto proof"], hunter, 0n);
const s1 = (await c.readContract({ address: C, functionName: "list_submissions", args: [hunter.address] })).slice(-1)[0].id;
await write("resolve_submission", [s1], hunter, 0n);
console.log("pending sid:", s1);

// 2. poster vetoes.
await write("challenge_submission", [s1, "veto proof reason"], poster, 0n);

// 3. poster tries to reclaim via cancel -> MUST be blocked (steward demand).
await expectRollback("veto-blocks-cancel",
  await write("cancel_bounty", [BID], poster, 0n),
  "must be re-resolved");

// 4. same PR resubmits fine (old claim is challenged, not live) -> resolve -> finalize -> paid.
await write("submit_work", [BID, PR, "resubmit after veto"], hunter, 0n);
const s2 = (await c.readContract({ address: C, functionName: "list_submissions", args: [hunter.address] })).slice(-1)[0].id;
await write("resolve_submission", [s2], hunter, 0n);
await write("finalize_submission", [s2], poster, 0n);
const b = await c.readContract({ address: C, functionName: "get_bounty", args: [BID] });
if (b.status === "paid") { console.log("PASS: veto-cycle-paid", b.final_severity, b.payout); pass++; }
else { console.log("FAIL: veto-cycle-paid, status=" + b.status); fail++; }

console.log(`\nRESULT: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
