// Standing veto-test bounty. Poster key persisted to TEMP (delete after the
// veto cycle completes). Run: node frontend/probe-standby.mjs
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import fs from "fs";

const C = "0x4dc39846CD32aB0033120eFa8Ebd19a0902396f6";
const KEYFILE = process.env.TEMP + "/hallmark_veto_poster.key";
const c = createClient({ chain: studionet });

let k;
try {
  k = fs.readFileSync(KEYFILE, "utf8").trim();
  console.log("reusing poster key");
} catch {
  k = generatePrivateKey();
  fs.writeFileSync(KEYFILE, k);
  console.log("new poster key saved");
}
const a = createAccount(k);
console.log("poster", a.address);

const h = await c.writeContract({
  address: C, functionName: "post_bounty",
  args: ["genlayerlabs/genlayer-js", "Veto-standby (keyed)", "veto-block proof as soon as a fresh-merged PR exists", "10", "50", "150", "500", "0"],
  value: BigInt(500), account: a,
});
console.log("post", h);
await c.waitForTransactionReceipt({ hash: h, status: "ACCEPTED" });
const bids = await c.readContract({ address: C, functionName: "list_bounties", args: [] });
const b = bids[bids.length - 1];
console.log("bid:", b.id, "created_at:", (await c.readContract({ address: C, functionName: "get_bounty", args: [b.id] })).created_at);
