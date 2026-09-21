# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import json


ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

VALID_SEVERITIES = ("low", "medium", "high", "critical")

CHALLENGE_PERIOD = 259200


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


def _handle_leader_error(leaders_res, leader_fn) -> bool:
    leader_msg = leaders_res.message if hasattr(leaders_res, "message") else ""
    try:
        leader_fn()
        return False
    except gl.vm.UserError as e:
        validator_msg = e.message if hasattr(e, "message") else str(e)
        if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(
            ERROR_EXTERNAL
        ):
            return validator_msg == leader_msg
        if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(
            ERROR_TRANSIENT
        ):
            return True
        return False
    except Exception:
        return False


def _parse_severity(analysis: dict) -> str:
    if not isinstance(analysis, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} Non-dict LLM response")
    raw = analysis.get("severity")
    if raw is None:
        for alt in ("tier", "level", "grade"):
            if alt in analysis:
                raw = analysis[alt]
                break
    if raw is None:
        raise gl.vm.UserError(f"{ERROR_LLM} Missing severity. Keys: {list(analysis.keys())}")
    s = str(raw).strip().lower()
    if s not in VALID_SEVERITIES:
        raise gl.vm.UserError(f"{ERROR_LLM} Invalid severity: {raw}")
    return s


@allow_storage
@dataclass
class Bounty:
    poster: Address
    repo: str
    title: str
    description: str
    low_amt: u256
    med_amt: u256
    high_amt: u256
    crit_amt: u256
    status: str
    winner: Address
    final_severity: str
    payout_amt: u256
    escrowed: u256
    deadline: u256
    merge_sha: str
    evidence_title: str
    challenge_deadline: u256


@allow_storage
@dataclass
class Submission:
    bounty_id: str
    hunter: Address
    pr_number: str
    notes: str
    status: str
    severity: str
    payout: u256
    pr_url: str
    merge_sha: str
    challenge_reason: str


@allow_storage
@dataclass
class HunterProfile:
    total_earned: u256
    completed: u256
    low_count: u256
    med_count: u256
    high_count: u256
    crit_count: u256
    level: str


def _level_for(completed: int, crits: int) -> str:
    if crits >= 3 or completed >= 20:
        return "legend"
    if completed >= 10:
        return "master"
    if completed >= 5:
        return "builder"
    if completed >= 1:
        return "contributor"
    return "novice"


class FutureOfWorkBounty(gl.Contract):
    owner: Address
    bounty_count: u256
    bounties: TreeMap[str, Bounty]
    bounty_order: DynArray[str]
    submission_count: u256
    submissions: TreeMap[str, Submission]
    profiles: TreeMap[Address, HunterProfile]
    total_escrowed: u256

    def __init__(self):
        self.owner = gl.message.sender_address
        self.bounty_count = u256(0)
        self.submission_count = u256(0)
        self.total_escrowed = u256(0)

    @gl.public.write.payable
    def post_bounty(
        self, repo: str, title: str, description: str, low_amt: u256, med_amt: u256, high_amt: u256, crit_amt: u256, deadline: u256
    ) -> str:
        # Harden input types: SDK/CLI clients may deliver u256 params as str.
        # Coerce once so storage setters never see a raw str (AttributeError).
        low_amt = u256(int(low_amt))
        med_amt = u256(int(med_amt))
        high_amt = u256(int(high_amt))
        crit_amt = u256(int(crit_amt))
        deadline = u256(int(deadline))
        if len(repo.strip()) == 0 or "/" not in repo:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} repo must be 'org/name'")
        if len(title.strip()) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} title required")
        if int(crit_amt) <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} crit_amt must be > 0")
        if int(deadline) != 0:
            now = int(datetime.now(timezone.utc).timestamp())
            if int(deadline) <= now:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} deadline must be in the future")
        msg_value = gl.message.value
        if int(msg_value) > 0:
            if int(msg_value) < int(crit_amt):
                raise gl.vm.UserError(f"{ERROR_EXPECTED} escrow {int(msg_value)} < crit {int(crit_amt)}")
            escrow = msg_value
        else:
            escrow = crit_amt
        if int(self.balance) < int(self.total_escrowed) + int(crit_amt):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} fund contract first via account send (need {int(crit_amt)})")
        self.total_escrowed = u256(int(self.total_escrowed) + int(escrow))
        bid = str(int(self.bounty_count))
        self.bounties[bid] = Bounty(
            poster=gl.message.sender_address,
            repo=repo.strip(),
            title=title,
            description=description,
            low_amt=low_amt,
            med_amt=med_amt,
            high_amt=high_amt,
            crit_amt=crit_amt,
            status="open",
            winner=Address("0x0000000000000000000000000000000000000000"),
            final_severity="",
            payout_amt=u256(0),
            escrowed=escrow,
            deadline=deadline,
            merge_sha="",
            evidence_title="",
            challenge_deadline=u256(0),
        )
        self.bounty_order.append(bid)
        self.bounty_count = u256(int(self.bounty_count) + 1)
        return bid

    @gl.public.write
    def submit_work(self, bounty_id: str, pr_number: str, notes: str) -> str:
        bounty_id = str(bounty_id)
        pr_number = str(pr_number)
        if bounty_id not in self.bounties:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Bounty not found")
        bounty = self.bounties[bounty_id]
        if bounty.status != "open":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Bounty not open")
        pr = pr_number.strip().lstrip("#")
        if len(pr) == 0 or not pr.isdigit() or int(pr) <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} pr_number must be a positive PR number")
        if gl.message.sender_address == bounty.poster:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} poster cannot hunt own bounty")
        sid = str(int(self.submission_count))
        self.submissions[sid] = Submission(
            bounty_id=bounty_id,
            hunter=gl.message.sender_address,
            pr_number=pr,
            notes=notes,
            status="submitted",
            severity="",
            payout=u256(0),
            pr_url=f"https://github.com/{bounty.repo}/pull/{pr}",
            merge_sha="",
            challenge_reason="",
        )
        self.submission_count = u256(int(self.submission_count) + 1)
        return sid

    def _fetch_and_grade(self, repo: str, pr_number: str, issue_desc: str) -> dict:
        api_url = f"https://api.github.com/repos/{repo}/pulls/{pr_number}"
        files_url = f"https://api.github.com/repos/{repo}/pulls/{pr_number}/files"
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "genlayer-bounty"}

        def _status_of(res) -> int:
            if hasattr(res, "status_code"):
                return int(res.status_code)
            return int(res.status)

        def _check(res, what: str):
            st = _status_of(res)
            if st == 403 or st == 429:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} GitHub rate-limited {what}: {st}")
            if st >= 400 and st < 500:
                raise gl.vm.UserError(f"{ERROR_EXTERNAL} GitHub API {what}: {st}")
            if st != 200:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} GitHub API {what}: {st}")

        def leader_fn():
            res = gl.nondet.web.get(api_url, headers=headers)
            _check(res, "pull")
            try:
                data = json.loads(res.body.decode("utf-8"))
            except Exception:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Bad GitHub JSON")
            merged = bool(data.get("merged", False))
            state = str(data.get("state", ""))
            sha = str(data.get("merge_commit_sha", "") or "")
            if not merged:
                return {"merged": False, "state": state, "sha": "", "severity": "", "reasoning": "PR not merged"}
            pr_title = str(data.get("title", ""))[:500]
            pr_body = str(data.get("body", "") or "")[:2000]
            additions = int(data.get("additions", 0))
            deletions = int(data.get("deletions", 0))
            changed_files = int(data.get("changed_files", 0))
            patch_excerpt = ""
            try:
                fres = gl.nondet.web.get(files_url, headers=headers)
                _check(fres, "files")
                files = json.loads(fres.body.decode("utf-8"))
                parts = []
                total = 0
                for f in files[:5]:
                    name = str(f.get("filename", ""))[:120]
                    patch = str(f.get("patch", "") or "")[:900]
                    chunk = f"\n--- {name}\n{patch}"
                    total += len(chunk)
                    if total > 3500:
                        break
                    parts.append(chunk)
                patch_excerpt = "".join(parts)[:3500]
            except gl.vm.UserError:
                raise
            except Exception:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Bad GitHub files JSON")
            prompt = (
                "You are a bug-bounty triager. Assign severity tier from the PR evidence below.\n"
                f"Issue: {issue_desc[:2000]}\n"
                f"PR title: {pr_title}\nPR body: {pr_body}\n"
                f"Diff stats: +{additions}/-{deletions} across {changed_files} files.\n"
                f"Patch evidence:{patch_excerpt}\n"
                "Rules: low=docs/typo/minor UI; medium=non-critical bug/feature gap; "
                "high=security weakness, data loss risk, core breakage; critical=RCE, fund loss, auth bypass.\n"
                'Return JSON only: {"severity":"low|medium|high|critical","reasoning":"..."}'
            )
            analysis = gl.nondet.exec_prompt(prompt, response_format="json")
            severity = _parse_severity(analysis)
            reasoning = str(analysis.get("reasoning", ""))[:1000]
            return {"merged": True, "state": state, "sha": sha, "severity": severity, "reasoning": reasoning, "title": pr_title}

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _handle_leader_error(leaders_res, leader_fn)
            try:
                v = leader_fn()
            except Exception:
                return False
            try:
                leader_merged = bool(leaders_res.calldata.get("merged", False))
            except Exception:
                return False
            if leader_merged != bool(v.get("merged", False)):
                return False
            if not v.get("merged", False):
                return True
            try:
                leader_sev = str(leaders_res.calldata.get("severity", "")).strip().lower()
                leader_sha = str(leaders_res.calldata.get("sha", ""))
            except Exception:
                return False
            if leader_sev != v.get("severity", ""):
                return False
            if leader_sha != v.get("sha", "") and v.get("sha", "") != "":
                return False
            return True

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    @gl.public.write
    def resolve_submission(self, submission_id: str) -> dict:
        submission_id = str(submission_id)
        if submission_id not in self.submissions:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Submission not found")
        sub = self.submissions[submission_id]
        if sub.status != "submitted":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Already resolved")
        bounty = self.bounties[sub.bounty_id]
        if bounty.status != "open":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Bounty closed")

        pr = self._fetch_and_grade(bounty.repo, sub.pr_number, bounty.description)
        if not bool(pr.get("merged", False)):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} PR not merged yet (state={pr.get('state', '')})")

        severity = str(pr.get("severity", ""))
        if severity == "low":
            payout = bounty.low_amt
        elif severity == "medium":
            payout = bounty.med_amt
        elif severity == "high":
            payout = bounty.high_amt
        elif severity == "critical":
            payout = bounty.crit_amt
        else:
            raise gl.vm.UserError(f"{ERROR_LLM} Unrecognized severity after consensus: {severity}")
        sha = str(pr.get("sha", ""))
        if len(sha) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No merge SHA from source, cannot settle")

        now = int(datetime.now(timezone.utc).timestamp())
        sub.status = "pending"
        sub.severity = severity
        sub.payout = payout
        sub.merge_sha = sha
        self.submissions[submission_id] = sub

        bounty.status = "pending"
        bounty.winner = sub.hunter
        bounty.final_severity = severity
        bounty.payout_amt = payout
        bounty.merge_sha = sha
        bounty.evidence_title = str(pr.get("title", ""))[:500]
        bounty.challenge_deadline = u256(now + CHALLENGE_PERIOD)
        self.bounties[sub.bounty_id] = bounty

        return {"severity": severity, "payout": str(int(payout)), "merged": True,
                "challenge_ends": str(int(bounty.challenge_deadline)),
                "reasoning": "advisory only, not consensus: " + str(pr.get("reasoning", ""))}

    @gl.public.write
    def challenge_submission(self, submission_id: str, reason: str) -> None:
        submission_id = str(submission_id)
        if submission_id not in self.submissions:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Submission not found")
        sub = self.submissions[submission_id]
        if sub.status != "pending":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only pending submissions can be challenged")
        bounty = self.bounties[sub.bounty_id]
        if gl.message.sender_address != bounty.poster:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only poster can challenge")
        if len(reason.strip()) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Challenge reason required")
        sub.status = "challenged"
        sub.challenge_reason = reason[:1000]
        self.submissions[submission_id] = sub
        bounty.status = "open"
        bounty.winner = Address("0x0000000000000000000000000000000000000000")
        bounty.final_severity = ""
        bounty.payout_amt = u256(0)
        bounty.merge_sha = ""
        bounty.evidence_title = ""
        bounty.challenge_deadline = u256(0)
        self.bounties[sub.bounty_id] = bounty

    @gl.public.write
    def finalize_submission(self, submission_id: str) -> dict:
        submission_id = str(submission_id)
        if submission_id not in self.submissions:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Submission not found")
        sub = self.submissions[submission_id]
        if sub.status != "pending":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Already settled or challenged")
        bounty = self.bounties[sub.bounty_id]
        if bounty.status != "pending":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Bounty not pending")
        now = int(datetime.now(timezone.utc).timestamp())
        if now <= int(bounty.challenge_deadline) and gl.message.sender_address != bounty.poster:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Challenge window still active")
        payout = sub.payout
        severity = sub.severity

        sub.status = "accepted"
        self.submissions[submission_id] = sub

        bounty.status = "paid"
        self.bounties[sub.bounty_id] = bounty

        hkey = sub.hunter
        if hkey in self.profiles:
            prof = self.profiles[hkey]
        else:
            prof = HunterProfile(
                total_earned=u256(0), completed=u256(0), low_count=u256(0),
                med_count=u256(0), high_count=u256(0), crit_count=u256(0), level="novice",
            )
        prof.total_earned = u256(int(prof.total_earned) + int(payout))
        prof.completed = u256(int(prof.completed) + 1)
        if severity == "low":
            prof.low_count = u256(int(prof.low_count) + 1)
        elif severity == "medium":
            prof.med_count = u256(int(prof.med_count) + 1)
        elif severity == "high":
            prof.high_count = u256(int(prof.high_count) + 1)
        elif severity == "critical":
            prof.crit_count = u256(int(prof.crit_count) + 1)
        else:
            raise gl.vm.UserError(f"{ERROR_LLM} Unrecognized severity after consensus: {severity}")
        prof.level = _level_for(int(prof.completed), int(prof.crit_count))
        self.profiles[hkey] = prof

        if int(payout) > 0:
            if int(self.balance) < int(payout):
                raise gl.vm.UserError(f"{ERROR_EXPECTED} Insufficient escrow")
            self.total_escrowed = u256(int(self.total_escrowed) - int(bounty.escrowed))
            _Recipient(sub.hunter).emit_transfer(value=payout)
            remainder = u256(int(bounty.escrowed) - int(payout))
            if int(remainder) > 0:
                _Recipient(bounty.poster).emit_transfer(value=remainder)

        return {"severity": severity, "payout": str(int(payout)), "merged": True}

    @gl.public.write
    def cancel_bounty(self, bounty_id: str) -> None:
        bounty_id = str(bounty_id)
        if bounty_id not in self.bounties:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Bounty not found")
        bounty = self.bounties[bounty_id]
        if gl.message.sender_address != bounty.poster and gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only poster can cancel")
        if bounty.status != "open":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Cannot cancel closed bounty")
        bounty.status = "cancelled"
        self.bounties[bounty_id] = bounty
        if int(bounty.escrowed) > 0:
            self.total_escrowed = u256(int(self.total_escrowed) - int(bounty.escrowed))
            _Recipient(bounty.poster).emit_transfer(value=bounty.escrowed)

    @gl.public.write
    def refund_expired(self, bounty_id: str) -> None:
        bounty_id = str(bounty_id)
        if bounty_id not in self.bounties:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Bounty not found")
        bounty = self.bounties[bounty_id]
        if bounty.status != "open":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Bounty not open")
        if int(bounty.deadline) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No deadline set")
        now = int(datetime.now(timezone.utc).timestamp())
        if now <= int(bounty.deadline):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Not expired yet")
        bounty.status = "cancelled"
        self.bounties[bounty_id] = bounty
        if int(bounty.escrowed) > 0:
            self.total_escrowed = u256(int(self.total_escrowed) - int(bounty.escrowed))
            _Recipient(bounty.poster).emit_transfer(value=bounty.escrowed)

    @gl.public.write
    def sweep(self) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only owner")
        free = int(self.balance) - int(self.total_escrowed)
        if free <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Nothing to sweep")
        _Recipient(self.owner).emit_transfer(value=u256(free))

    @gl.public.view
    def get_bounty(self, bounty_id: str) -> dict:
        bounty_id = str(bounty_id)
        if bounty_id not in self.bounties:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Bounty not found")
        b = self.bounties[bounty_id]
        return {
            "id": bounty_id, "repo": b.repo, "title": b.title, "description": b.description,
            "tiers": {"low": str(int(b.low_amt)), "medium": str(int(b.med_amt)), "high": str(int(b.high_amt)), "critical": str(int(b.crit_amt))},
            "status": b.status, "winner": str(b.winner), "final_severity": b.final_severity, "payout": str(int(b.payout_amt)),
            "escrowed": str(int(b.escrowed)), "poster": str(b.poster),
            "deadline": str(int(b.deadline)), "merge_sha": b.merge_sha, "evidence_title": b.evidence_title,
            "challenge_deadline": str(int(b.challenge_deadline)),
        }

    @gl.public.view
    def list_bounties(self) -> list:
        out: list = []
        for i in range(len(self.bounty_order)):
            bid = self.bounty_order[i]
            b = self.bounties[bid]
            out.append({"id": bid, "repo": b.repo, "title": b.title, "status": b.status, "final_severity": b.final_severity})
        return out

    @gl.public.view
    def get_submission(self, submission_id: str) -> dict:
        submission_id = str(submission_id)
        if submission_id not in self.submissions:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Submission not found")
        s = self.submissions[submission_id]
        return {
            "id": submission_id, "bounty_id": s.bounty_id, "hunter": str(s.hunter),
            "pr_number": s.pr_number, "pr_url": s.pr_url, "notes": s.notes, "status": s.status,
            "severity": s.severity, "payout": str(int(s.payout)), "merge_sha": s.merge_sha,
            "challenge_reason": s.challenge_reason,
        }

    @gl.public.view
    def list_submissions(self, hunter: Address) -> list:
        out: list = []
        for i in range(int(self.submission_count)):
            sid = str(i)
            s = self.submissions[sid]
            if s.hunter == hunter:
                out.append({"id": sid, "bounty_id": s.bounty_id, "pr_url": s.pr_url, "status": s.status, "severity": s.severity, "payout": str(int(s.payout))})
        return out

    @gl.public.view
    def get_reputation(self, hunter: Address) -> dict:
        if hunter not in self.profiles:
            return {"hunter": str(hunter), "level": "novice", "completed": "0", "total_earned": "0",
                    "breakdown": {"low": "0", "medium": "0", "high": "0", "critical": "0"}}
        p = self.profiles[hunter]
        return {
            "hunter": str(hunter), "level": p.level, "completed": str(int(p.completed)),
            "total_earned": str(int(p.total_earned)),
            "breakdown": {"low": str(int(p.low_count)), "medium": str(int(p.med_count)),
                           "high": str(int(p.high_count)), "critical": str(int(p.crit_count))},
        }
