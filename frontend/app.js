import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const CONTRACT = "0xfe57D304623471A6aB8db137d73D2766b610eEA5";
const $ = (s) => document.querySelector(s);
const ledger = $("#ledger"), card = $("#passportCard"), hint = $("#txHint"), resultBox = $("#txResult");

const EXPLORER = "https://explorer-studio.genlayer.com";

function setHint(msg, kind) {
  hint.textContent = msg;
  hint.classList.remove("ok", "err");
  if (kind) hint.classList.add(kind);
}

function showResult(html, isErr) {
  resultBox.hidden = false;
  resultBox.classList.toggle("err", !!isErr);
  resultBox.innerHTML = html;
}

function hideResult() {
  resultBox.hidden = true;
  resultBox.classList.remove("err");
  resultBox.innerHTML = "";
}

const readClient = createClient({ chain: studionet });
let writeClient = null;
let connectedAddr = null;

$("#contractAddr").textContent = CONTRACT.slice(0, 6) + "…" + CONTRACT.slice(-4);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function read(fn, args = []) {
  return readClient.readContract({ address: CONTRACT, functionName: fn, args });
}

function executionError(receipt) {
  const leader = receipt?.consensus_data?.leader_receipt?.[0];
  return leader?.error || receipt?.txExecutionResultName || "execution failed";
}

function txRow(label, value) {
  return `<dt>${esc(label)}</dt><dd>${value}</dd>`;
}

function explorerLink(hash) {
  return `<a href="${esc(EXPLORER)}/tx/${esc(hash)}" target="_blank" rel="noopener">${esc(hash)}</a>`;
}

function baseResultHtml(fn, hash, receipt) {
  const exec = esc(receipt.txExecutionResultName || "unknown");
  return `<h4>✓ ${esc(fn)} — FINALIZED</h4>
    <dl>
      ${txRow("tx hash", explorerLink(hash))}
      ${txRow("execution", exec)}
    </dl>
    <p class="note">Verify in GenLayer Studio Explorer (link above opens the exact transaction). No local cache involved: the ledger below re-reads from chain.</p>`;
}

async function showResolveResult(sid, hash, receipt) {
  // All consensus facts below are read back from chain — never invented locally.
  let body = "";
  try {
    const s = await read("get_submission", [String(sid)]);
    const b = await read("get_bounty", [String(s.bounty_id)]);
    const cd = b.challenge_deadline && b.challenge_deadline !== "0"
      ? new Date(Number(b.challenge_deadline) * 1000).toISOString()
      : "—";
    body = `<h4>✓ resolve_submission #${esc(sid)} — FINALIZED</h4>
      <dl>
        ${txRow("tx hash", explorerLink(hash))}
        ${txRow("severity (consensus)", esc(s.severity))}
        ${txRow("payout", esc(s.payout))}
        ${txRow("merged", "true")}
        ${txRow("merge SHA", esc(s.merge_sha))}
        ${txRow("PR", `<a href="${esc(s.pr_url)}" target="_blank" rel="noopener">${esc(s.pr_url)}</a>`)}
        ${txRow("evidence title", esc(b.evidence_title || "—"))}
        ${txRow("challenge ends", esc(cd))}
      </dl>
      <p class="note">Severity, payout, merge SHA and PR title above are the exact values validators agreed on, read back via <code>get_submission</code> + <code>get_bounty</code>. The LLM's free-text reasoning is advisory only (not consensus) and is intentionally not shown — verify the full receipt in the explorer.</p>`;
  } catch (e) {
    body = `${baseResultHtml("resolve_submission", hash, receipt)}
      <p class="note">On-chain read-back failed (${esc(e.message)}) — showing receipt only. Nothing was taken from local storage.</p>`;
  }
  showResult(body, false);
}

function showErrorResult(fn, err) {
  showResult(`<h4>✕ ${esc(fn)} failed</h4>
    <dl>${txRow("reason", esc(err.message || String(err)))}</dl>
    <p class="note">This is the real chain/SDK error (e.g. <code>[EXPECTED]</code> rollbacks). No state was changed.</p>`, true);
}

async function writeConfirmed(fn, args = [], btn) {
  if (!writeClient || !connectedAddr)
    throw new Error("Connect a wallet first (MetaMask on studionet).");
  hideResult();
  const hash = await writeClient.writeContract({
    address: CONTRACT,
    functionName: fn,
    args,
    value: BigInt(0),
  });
  setHint(`Pending ${fn} → ${hash} (waiting for FINALIZED…)`);
  if (btn) btn.disabled = true;
  try {
    const receipt = await readClient.waitForTransactionReceipt({
      hash,
      status: "FINALIZED",
    });
    if (receipt.txExecutionResultName === "FINISHED_WITH_ERROR")
      throw new Error(executionError(receipt));
    setHint(`Confirmed ${fn} → ${hash}`, "ok");
    return { hash, receipt };
  } catch (e) {
    setHint(`${fn} failed: ${e.message}`, "err");
    throw e;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function entry(b) {
  const d = document.createElement("div");
  d.className = "entry";
  d.dataset.sev = (b.final_severity || "open").toLowerCase();
  d.innerHTML = `<span class="seal-dot"></span>
    <div><h3>#${esc(b.id)} · ${esc(b.title)}</h3><p>${esc(b.repo)} · ${esc(b.status)}${b.final_severity ? " · " + esc(b.final_severity) : ""}</p></div>
    <div class="meta">${b.status === "paid" ? "◉ paid" : "○ " + esc(b.status)}</div>`;
  return d;
}

async function refresh() {
  try {
    ledger.innerHTML = `<p class="empty">Reading ledger…</p>`;
    const list = await read("list_bounties");
    ledger.innerHTML = "";
    if (!list || !list.length) ledger.innerHTML = `<p class="empty">No bounties yet — seal the first one below.</p>`;
    for (const b of list) ledger.appendChild(entry(b));
  } catch (e) { ledger.innerHTML = `<p class="empty">Ledger unreachable: ${esc(e.message)}</p>`; }
}

async function reputation(addr) {
  try {
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      card.innerHTML = `<p class="empty">Enter a valid 0x address.</p>`;
      return;
    }
    const r = await read("get_reputation", [addr]);
    const b = r.breakdown || {};
    card.innerHTML = `<p class="eyebrow">Passport · ${esc(r.hunter)}</p>
      <p class="pass-level">${esc(r.level)}</p>
      <div class="pass-grid">
        <div><dt>Done</dt><dd>${esc(r.completed)}</dd></div>
        <div><dt>Earned</dt><dd>${esc(r.total_earned)}</dd></div>
        <div><dt>Low/Med</dt><dd>${esc(b.low)}/${esc(b.medium)}</dd></div>
        <div><dt>High/Crit</dt><dd>${esc(b.high)}/${esc(b.critical)}</dd></div>
      </div>`;
  } catch (e) { card.innerHTML = `<p class="empty">Unreadable: ${esc(e.message)}</p>`; }
}

async function mySubs() {
  const box = $("#mySubs");
  try {
    if (!connectedAddr) { box.innerHTML = `<p class="empty">Connect a wallet to see your claims.</p>`; return; }
    box.innerHTML = `<p class="empty">Reading your submissions…</p>`;
    const list = await read("list_submissions", [connectedAddr]);
    box.innerHTML = "";
    if (!list || !list.length) box.innerHTML = `<p class="empty">No submissions yet — link a PR above.</p>`;
    for (const s of list) {
      const d = document.createElement("div");
      d.className = "entry";
      d.dataset.sev = (s.severity || "open").toLowerCase();
      d.innerHTML = `<span class="seal-dot"></span>
        <div><h3>#${esc(s.id)} → bounty ${esc(s.bounty_id)}</h3>
        <p><a href="${esc(s.pr_url)}" target="_blank" rel="noopener">${esc(s.pr_url)}</a> · ${esc(s.status)}${s.severity ? " · " + esc(s.severity) : ""}</p></div>
        <div class="meta">${s.payout !== "0" ? "◉ " + esc(s.payout) : "○ pending"}</div>`;
      box.appendChild(d);
    }
  } catch (e) { box.innerHTML = `<p class="empty">Unreadable: ${esc(e.message)}</p>`; }
}

$("#refreshBtn").onclick = refresh;
$("#mySubsBtn").onclick = mySubs;
$("#repForm").onsubmit = (e) => { e.preventDefault(); reputation(new FormData(e.target).get("hunter").trim()); };
$("#connectBtn").onclick = async (e) => {
  const btn = e.currentTarget;
  try {
    if (!window.ethereum) { setHint("No injected wallet found.", "err"); return; }
    btn.disabled = true;
    const [addr] = await window.ethereum.request({ method: "eth_requestAccounts" });
    writeClient = createClient({ chain: studionet, account: addr, provider: window.ethereum });
    try { await writeClient.connect("studionet"); } catch (err) { setHint("Network switch: " + err.message, "err"); }
    connectedAddr = addr;
    $("#connectBtn").textContent = addr.slice(0, 6) + "…" + addr.slice(-4);
    setHint(`Connected ${addr} — writes are signed in-wallet, reads stay public.`, "ok");
    mySubs();
  } catch (err) { setHint("Connect failed: " + err.message, "err"); }
  finally { btn.disabled = false; }
};
$("#postForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const dl = (f.get("deadline") || "").toString().trim();
  const deadline = dl ? Math.floor(new Date(dl).getTime() / 1000) : 0;
  try {
    const { hash, receipt } = await writeConfirmed("post_bounty", [f.get("repo").trim(), f.get("title").trim(), f.get("description") || "", String(Number(f.get("low"))), String(Number(f.get("med"))), String(Number(f.get("high"))), String(Number(f.get("crit"))), String(deadline)], e.submitter);
    showResult(baseResultHtml("post_bounty", hash, receipt), false);
    refresh();
  }
  catch (err) { showErrorResult("post_bounty", err); }
};
$("#submitForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { hash, receipt } = await writeConfirmed("submit_work", [String(f.get("bounty_id")).trim(), String(f.get("pr")).trim(), f.get("notes") || ""], e.submitter);
    showResult(baseResultHtml("submit_work", hash, receipt), false);
    mySubs();
  }
  catch (err) { showErrorResult("submit_work", err); }
};
$("#resolveForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const sid = String(f.get("submission_id")).trim();
  try {
    const { hash, receipt } = await writeConfirmed("resolve_submission", [sid], e.submitter);
    await showResolveResult(sid, hash, receipt);
    refresh(); mySubs();
  }
  catch (err) { showErrorResult("resolve_submission", err); }
};
$("#finalizeForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { hash, receipt } = await writeConfirmed("finalize_submission", [String(f.get("submission_id")).trim()], e.submitter);
    showResult(baseResultHtml("finalize_submission", hash, receipt), false);
    refresh(); mySubs();
  }
  catch (err) { showErrorResult("finalize_submission", err); }
};
$("#challengeForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { hash, receipt } = await writeConfirmed("challenge_submission", [String(f.get("submission_id")).trim(), f.get("reason")], e.submitter);
    showResult(baseResultHtml("challenge_submission", hash, receipt), false);
    refresh(); mySubs();
  }
  catch (err) { showErrorResult("challenge_submission", err); }
};
$("#cancelForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { hash, receipt } = await writeConfirmed("cancel_bounty", [String(f.get("bounty_id")).trim()], e.submitter);
    showResult(baseResultHtml("cancel_bounty", hash, receipt), false);
    refresh();
  }
  catch (err) { showErrorResult("cancel_bounty", err); }
};
$("#refundForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { hash, receipt } = await writeConfirmed("refund_expired", [String(f.get("bounty_id")).trim()], e.submitter);
    showResult(baseResultHtml("refund_expired", hash, receipt), false);
    refresh();
  }
  catch (err) { showErrorResult("refund_expired", err); }
};
$("#sweepBtn").onclick = async (e) => {
  try {
    const { hash, receipt } = await writeConfirmed("sweep", [], e.currentTarget);
    showResult(baseResultHtml("sweep", hash, receipt), false);
  }
  catch (err) { showErrorResult("sweep", err); }
};

refresh();
window.__hallmarkReady = true;
