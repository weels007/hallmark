// Posts a standing veto-test bounty with a persisted poster key.
// Usage: node frontend/standby-post.mjs <org/repo> "<title>"
// Saves poster key to %TEMP%/hallmark_veto_poster_<bid>.key for veto-proof.mjs.
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import fs from "fs";

const C = "0x4dc39846CD32aB0033120eFa8Ebd19a0902396f6";
const [repo, title] = process.argv.slice(2);
if (!repo || !repo.includes("/") || !title) {
  console.error('Usage: node frontend/standby-post.mjs <org/repo> "<title>"');
  process.exit(2);
}

const c = createClient({ chain: studionet });
const k = generatePrivateKey();
const a = createAccount(k);
console.log("poster", a.address);

const h = await c.writeContract({
  address: C, functionName: "post_bounty",
  args: [repo, title, "standing bounty for veto-block proof", "10", "50", "150", "500", "0"],
  value: BigInt(500), account: a,
});
console.log("post", h);
await c.waitForTransactionReceipt({ hash: h, status: "ACCEPTED" });
const bids = await c.readContract({ address: C, functionName: "list_bounties", args: [] });
const bid = bids[bids.length - 1].id;
const b = await c.readContract({ address: C, functionName: "get_bounty", args: [bid] });
fs.writeFileSync(`${process.env.TEMP}/hallmark_veto_poster_${bid}.key`, k);
console.log(`bid ${bid} created_at ${b.created_at} status ${b.status} key saved`);
