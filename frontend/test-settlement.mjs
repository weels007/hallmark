// Settlement + accounting tests for the steward review (GenLayer studionet).
// Covers paths the CLI cannot reach (payable posts need msg.value).
// Usage: node scripts/test-settlement.mjs 0xCONTRACT
// Needs ~10 min (one deadline sleep + two consensus resolves). All amounts wei.
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const C = process.argv[2];
if (!/^0x[0-9a-fA-F]{40}$/.test(C || "")) {
  console.error("Usage: node scripts/test-settlement.mjs 0xCONTRACT");
  process.exit(2);
}

const c = createClient({ chain: studionet });
const poster = createAccount();
const hunter = createAccount();
let pass = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);

async function write(fn, args, account, value = 0n) {
  const h = await c.writeContract({ address: C, functionName: fn, args, value, account });
  await c.waitForTransactionReceipt({ hash: h, status: "ACCEPTED" });
  return h;
}
async function expectRollback(label, hash, needle) {
  const t = await c.getTransaction({ hash });
  const p = JSON.stringify(t?.consensus_data?.leader_receipt?.[0]?.result ?? "");
  if (p.includes(needle)) { console.log(`PASS: ${label}`); pass++; }
  else { console.log(`FAIL: ${label} (missing '${needle}') :: ${p.slice(0, 160)}`); fail++; }
}
function ok(label, cond, extra = "") {
  if (cond) { console.log(`PASS: ${label}`); pass++; }
  else { console.log(`FAIL: ${label} ${extra}`); fail++; }
}
async function lastBid() {
  const l = await c.readContract({ address: C, functionName: "list_bounties", args: [] });
  return l[l.length - 1].id;
}

// T-a: bounty funded by its own posting tx, tiers recorded exactly.
const ha = await write("post_bounty",
  ["octocat/Hello-World", "T-a funding", "payable probe", "10", "50", "150", "500", "0"],
  poster, 500n);
const ba = await c.readContract({ address: C, functionName: "get_bounty", args: [await lastBid()] });
ok("fund-from-posting-tx", ba.escrowed === "500", JSON.stringify(ba.tiers));
ok("tiers-recorded", ba.tiers.low === "10" && ba.tiers.medium === "50" && ba.tiers.high === "150" && ba.tiers.critical === "500");

// T-b: tier + deposit validation.
await expectRollback("tier-zero",
  await write("post_bounty", ["octocat/Hello-World", "T-b0", "x", "0", "50", "150", "500", "0"], poster, 500n),
  "tiers must be positive");
await expectRollback("tier-unordered",
  await write("post_bounty", ["octocat/Hello-World", "T-b1", "x", "10", "150", "50", "500", "0"], poster, 500n),
  "tiers must be ordered");
await expectRollback("underfunded-post",
  await write("post_bounty", ["octocat/Hello-World", "T-b2", "x", "10", "50", "150", "500", "0"], poster, 100n),
  "must fund escrow");

// T-c: duplicate claims rejected (same bounty + PR, live statuses).
const hc = await write("post_bounty",
  ["octocat/Hello-World", "T-c dup", "dup probe", "10", "50", "150", "500", "0"], poster, 500n);
await c.waitForTransactionReceipt({ hash: hc, status: "ACCEPTED" });
const bidC = await lastBid();
await write("submit_work", [bidC, "11245", "first"], hunter, 0n);
await expectRollback("duplicate-claim",
  await write("submit_work", [bidC, "11245", "again"], hunter, 0n),
  "Duplicate claim");

// T-d: post-deadline claims rejected.
const dl = String(nowS() + 90);
const hd = await write("post_bounty",
  ["octocat/Hello-World", "T-d expiry", "expiry probe", "10", "50", "150", "500", dl], poster, 500n);
await c.waitForTransactionReceipt({ hash: hd, status: "ACCEPTED" });
const bidD = await lastBid();
await sleep(100000);
await expectRollback("post-deadline-claim",
  await write("submit_work", [bidD, "11245", "late"], hunter, 0n),
  "Bounty expired");

// T-e: PR predating the bounty cannot settle (old merged PR + fresh bounty).
const he = await write("post_bounty",
  ["genlayerlabs/genlayer-js", "T-e predate", "predate probe", "10", "50", "150", "500", "0"], poster, 500n);
await c.waitForTransactionReceipt({ hash: he, status: "ACCEPTED" });
const bidE = await lastBid();
await write("submit_work", [bidE, "218", "old pr"], hunter, 0n);
const subs = await c.readContract({ address: C, functionName: "list_submissions", args: [hunter.address] });
const sidE = subs[subs.length - 1].id;
await expectRollback("predates-bounty",
  await write("resolve_submission", [sidE], hunter, 0n),
  "PR predates bounty");

// T-g: unmerged PR cannot settle (open PR fixture).
const hg = await write("post_bounty",
  ["octocat/Hello-World", "T-g unmerged", "unmerged probe", "10", "50", "150", "500", "0"], poster, 500n);
await c.waitForTransactionReceipt({ hash: hg, status: "ACCEPTED" });
const bidG = await lastBid();
await write("submit_work", [bidG, "11245", "open pr"], hunter, 0n);
const subsG = await c.readContract({ address: C, functionName: "list_submissions", args: [hunter.address] });
const sidG = subsG[subsG.length - 1].id;
await expectRollback("unmerged-resolve",
  await write("resolve_submission", [sidG], hunter, 0n),
  "PR not merged yet");

console.log(`\nRESULT: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
