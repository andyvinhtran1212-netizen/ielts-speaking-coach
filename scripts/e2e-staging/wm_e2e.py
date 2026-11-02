#!/usr/bin/env python3
"""Staging-only WM API journey. No login, account creation, SQL or paid AI."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import json
import os
import re
import secrets
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID, uuid4


STAGING_HOST = "ielts-speaking-coach-staging.up.railway.app"
STAGING_URL = f"https://{STAGING_HOST}"
ROLES = ("INSTRUCTOR", "ADMIN", "STUDENT", "LATE_STUDENT")


class Stop(RuntimeError):
    """Only fixed, credential-free messages may cross the CLI boundary."""


class APIError(Stop):
    def __init__(self, status: int):
        self.status = status
        super().__init__(f"API HTTP {status}; response body and headers withheld")


def staging_url(value: str) -> str:
    try:
        u = urlsplit(value)
        valid = (u.scheme == "https" and u.hostname == STAGING_HOST
                 and u.netloc in (STAGING_HOST, STAGING_HOST + ":443")
                 and u.port in (None, 443) and u.path in ("", "/")
                 and not (u.username or u.password or u.query or u.fragment)
                 and "?" not in value and "#" not in value
                 and not any(c.isspace() for c in value))
    except ValueError:
        valid = False
    if not valid:
        raise Stop("E2E_BASE_URL must be the allowlisted staging HTTPS origin")
    return STAGING_URL


def run_marker(run_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,47}", run_id):
        raise Stop("run-id must contain 1–48 ASCII letters, digits or hyphens")
    return "E2E-" + run_id


@dataclass(frozen=True)
class Config:
    base_url: str
    tokens: dict[str, str] = field(repr=False)
    speaking_topic: str | None = None
    listening_test: str | None = None

    @classmethod
    def from_env(cls, env):
        base = staging_url(env.get("E2E_BASE_URL", STAGING_URL))
        tokens = {}
        for role in ROLES:
            name = f"E2E_{role}_TOKEN"
            value = env.get(name, "")
            if value:
                if not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", value):
                    raise Stop(f"{name} must be a JWT without whitespace")
                tokens[role] = value
        ids = []
        for name in ("E2E_SPEAKING_TOPIC_ID", "E2E_LISTENING_TEST_ID"):
            value = env.get(name, "")
            try:
                ids.append(str(UUID(value)) if value else None)
            except ValueError:
                raise Stop(f"{name} must be a UUID") from None
        return cls(base, tokens, *ids)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class API:
    def __init__(self, config: Config):
        self.config = config
        # Do not allow an environment proxy or a redirect to forward credentials.
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def call(self, role: str, method: str, path: str, body=None):
        staging_url(self.config.base_url)
        if not path.startswith("/") or path.startswith("//") or "#" in path:
            raise Stop("Invalid internal API path")
        # Defense in depth: never expose an accidental paid grading path here.
        route = urlsplit(path).path
        if (re.fullmatch(r"/sessions/[^/]+/responses", route)
                or "/api/writing/" in route and route.endswith("/submit")
                or any(x in path for x in ("/regrade", "/generate", "/compose"))):
            raise Stop("Paid or unverified fixture route is disabled")
        token = self.config.tokens[role]
        request = Request(self.config.base_url + path, method=method,
                          data=None if body is None else json.dumps(body).encode(),
                          headers={"Authorization": "Bearer " + token,
                                   "Content-Type": "application/json",
                                   "X-Show-Test-Data": "1"})
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except HTTPError as exc:
            status = exc.code
            exc.close()
            raise APIError(status) from None
        except (URLError, OSError, ValueError):
            raise Stop("API transport/JSON failure; no retry; run cleanup with the same run-id") from None


def check(condition, message: str):
    if not condition:
        raise Stop(message)


def row_id(row: dict) -> str:
    try:
        return str(UUID(row["id"]))
    except (KeyError, TypeError, ValueError):
        raise Stop("API returned an invalid record ID") from None


class Journey:
    def __init__(self, config: Config, marker: str, api=None):
        self.config, self.marker = config, marker
        self.api = api or API(config)
        self.incomplete = False

    def call(self, role, method, path, body=None):
        result = self.api.call(role, method, path, body)
        if method == "GET":
            collections = [result] if isinstance(result, list) else [
                result.get(key) for key in ("cohorts", "assignments", "members")
            ] if isinstance(result, dict) else []
            check(not any(isinstance(rows, list) and len(rows) >= 1000 for rows in collections),
                  "API collection may be capped; cannot prove complete discovery/cleanup")
        return result

    def skip(self, message):
        self.incomplete = True
        print("SKIP " + message)

    def owned(self, row, key):
        # Delimiter prevents E2E-foo from selecting E2E-foobar or E2E-foo-bar.
        value = row.get(key) or ""
        return value == self.marker or value.startswith(self.marker + " · ")

    def identity(self, role):
        profile = self.call(role, "GET", "/auth/profile")
        check((profile.get("display_name") or "").startswith("QA TEST"),
              "Every supplied token must belong to a provisioned QA TEST identity")
        expected = {"ADMIN": {"admin"}, "INSTRUCTOR": {"instructor"},
                    "STUDENT": {"user"}, "LATE_STUDENT": {"user"}}[role]
        check(profile.get("role") in expected and profile.get("is_active") is True,
              "QA TEST identity has an unexpected role or inactive account")
        check((profile.get("email") or "").endswith("@staging-e2e.averlearning.com"),
              "QA TEST identities must use the staging-e2e email domain (also bypasses test-data hiding)")
        row_id(profile)
        return profile

    def cohorts(self):
        return [r for r in self.call("ADMIN", "GET", "/admin/cohorts")["cohorts"]
                if self.owned(r, "name")]

    def join(self, role, cohort_id, student, expected_students):
        self.call("INSTRUCTOR", "POST", "/instructor/codes",
                  {"cohort_id": cohort_id, "count": 1, "notes": self.marker})
        codes = [r for r in self.call("INSTRUCTOR", "GET", "/instructor/codes")
                 if r.get("cohort_id") == cohort_id and self.owned(r, "notes")
                 and not r.get("is_used") and r.get("is_active")]
        check(len(codes) == 1, "Expected exactly one unused run-owned join code")
        receipt = self.call(role, "POST", "/auth/activate", {"access_code": codes[0]["code"]})
        check(receipt.get("success") is True, "Code join was not acknowledged")
        members = self.call("ADMIN", "GET", f"/admin/cohorts/{cohort_id}/members")["members"]
        check({r["student_id"] for r in members} == expected_students,
              "Joined class roster differs from the expected QA TEST students")
        check(any(r["student_id"] == student["id"] for r in members), "Code join did not persist")
        print("PASS " + ("late code join" if role == "LATE_STUDENT" else "code join"))

    def class_items(self, role, cohort_id):
        result = self.call(role, "GET", "/api/class/my-assignments")
        return [r for r in result["assignments"] if r["assignment"].get("cohort_id") == cohort_id]

    def grammar(self, item):
        session = self.call("STUDENT", "POST", "/api/grammar/diagnostics/sessions",
                            {"mode": "REVIEW", "module": "GENERAL", "test_length": "QUICK",
                             "class_assignment_item_id": item["item_id"]})
        path = "/api/grammar/diagnostics/sessions/" + row_id(session)
        # QUICK has 28 objective questions; use a finite guard on schema drift.
        for _ in range(60):
            next_item = self.call("STUDENT", "POST", path + "/next", {})
            if next_item.get("complete"):
                break
            question = next_item["item"]
            self.call("STUDENT", "POST", path + "/responses",
                      {"item_id": question["item_id"], "selected_option": 0,
                       "response_time_ms": 1000, "assistance_used": False})
        else:
            raise Stop("Grammar journey exceeded the documented question bound")
        self.call("STUDENT", "POST", path + "/complete", {})
        report = self.call("STUDENT", "GET", path + "/report")
        check(report.get("session_id") == session["id"], "Grammar report did not persist")
        print("PASS Grammar fixture choices submitted; deterministic rules report persisted")

    def listening(self, item):
        test = self.config.listening_test
        # This backend start route abandons all open attempts for this user/test.
        # The learner resume endpoint excludes mock sittings. Check admin truth
        # as well so even an open mock is protected from the start-over route.
        prior = self.call("ADMIN", "GET", "/admin/listening/attempts?status=in_progress&user_query=QA%20TEST&limit=200")
        check(not prior.get("association_lookup_failed") and prior["total"] <= 200,
              "Cannot safely enumerate open QA Listening attempts")
        check(not any(r["user"]["id"] == self.learner_id and r["test"]["id"] == test for r in prior["items"]),
              "QA learner already has an open Listening attempt; refusing start-over")
        result = self.call("STUDENT", "POST",
                           f"/api/listening/tests/{test}/attempts?class_item={item['item_id']}", {})
        attempt = str(UUID(result["attempt_id"]))
        path = "/api/listening/tests/attempts/" + attempt
        # A deliberately wrong, identifiable fixture answer; no answer keys needed.
        self.call("STUDENT", "PATCH", path + "/answers", {"q_num": 1, "user_answer": self.marker})
        self.call("STUDENT", "POST", path + "/submit", {})
        stored = self.call("STUDENT", "GET", path)
        check(stored.get("status") == "submitted", "Listening submission did not persist")
        print("PASS Listening fixture answer submitted; deterministic grade persisted")

    def run(self):
        for role in ("INSTRUCTOR", "ADMIN", "STUDENT"):
            if role not in self.config.tokens:
                self.skip(f"give/join/submit/cleanup require E2E_{role}_TOKEN")
        if self.incomplete:
            return 2
        profiles = {role: self.identity(role) for role in ROLES if role in self.config.tokens}
        self.learner_id = profiles["STUDENT"]["id"]
        check(len({r["id"] for r in profiles.values()}) == len(profiles), "QA identities must be distinct")
        roster = self.call("INSTRUCTOR", "GET", "/instructor/students")
        students = {}
        for role in ("STUDENT", "LATE_STUDENT"):
            if role not in profiles:
                continue
            matches = [s for s in roster if s.get("user_id") == profiles[role]["id"]]
            check(len(matches) == 1 and (matches[0].get("full_name") or "").startswith("QA TEST"),
                  "QA learner must already have one visible, instructor-owned student record")
            students[role] = matches[0]
        check(not self.cohorts(), "Run-id already exists; use --cleanup, then choose a fresh run-id")
        cohort = self.call("INSTRUCTOR", "POST", "/instructor/cohorts",
                           {"name": self.marker, "description": self.marker})
        cid = row_id(cohort)
        print("PASS created " + self.marker + "; retain run-id for --cleanup")
        self.join("STUDENT", cid, students["STUDENT"], {students["STUDENT"]["id"]})
        prompt = self.call("INSTRUCTOR", "POST", "/instructor/prompts",
                           {"title": self.marker + " · Writing", "task_type": "task2",
                            "prompt_text": self.marker + " Discuss the benefits of daily English practice."})
        give = self.call("INSTRUCTOR", "POST", "/instructor/assignments/fan-out",
                         {"request_id": str(uuid4()), "prompt_ids": [row_id(prompt)],
                          "cohort_id": cid, "name": self.marker + " · Writing", "instructions": self.marker})
        check(give.get("created_count") == 1, "Writing give did not create exactly one assignment")
        early_writing = self.call("STUDENT", "GET", "/api/writing/my-assignments")["assignments"]
        # Learner Writing lists expose group/name/assignment IDs, not cohort_id.
        group_id = str(UUID(give["group_id"]))
        check(sum(r["id"] in give["assignment_ids"] and r.get("assignment_group_id") == group_id
                  and self.owned(r, "name") for r in early_writing) == 1,
              "Writing give is absent or duplicated in the learner's canonical list")
        print("PASS instructor Writing give and learner list")
        self.skip("Writing submit + grading: no server fixture; submit automatically schedules paid AI. Give only; no draft/start.")
        self.skip("Speaking submit + grading: GRADING_PROVIDER_MODE=fixture exists server-side, but no mode attestation API; upload runs STT/grading immediately.")
        assignments = {}
        for skill, source in (("grammar", True), ("speaking", self.config.speaking_topic),
                              ("listening", self.config.listening_test)):
            if not source:
                self.skip(f"{skill} give: missing E2E_{'SPEAKING_TOPIC_ID' if skill == 'speaking' else 'LISTENING_TEST_ID'}")
                continue
            body = {"skill": skill, "title": self.marker + " · " + skill,
                    "instructions": self.marker, "due_date": (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat(),
                    "due_time": "23:59"}
            if skill != "grammar":
                body["content_id"] = source
            assignment = self.call("ADMIN", "POST", f"/admin/cohorts/{cid}/assignments", body)
            assignments[skill] = row_id(assignment)
            print("PASS " + skill + " give via QA admin (API is admin-only)")
        if "LATE_STUDENT" in students:
            self.join("LATE_STUDENT", cid, students["LATE_STUDENT"], {s["id"] for s in students.values()})
            # Writing backfills on activation; the other skills require explicit backfill.
            late_writing = self.call("LATE_STUDENT", "GET", "/api/writing/my-assignments")["assignments"]
            check(sum(r.get("assignment_group_id") == group_id and self.owned(r, "name")
                      for r in late_writing) == 1,
                  "Late join did not automatically receive the open Writing give")
            for aid in assignments.values():
                self.call("ADMIN", "POST", f"/admin/cohorts/{cid}/assignments/{aid}/backfill",
                          {"student_ids": [students["LATE_STUDENT"]["id"]]})
            late_ids = {r["assignment"]["id"] for r in self.class_items("LATE_STUDENT", cid)}
            check(set(assignments.values()) <= late_ids, "Late join explicit class backfill did not persist")
            print("PASS late Writing auto-backfill + explicit other-skill backfill")
        else:
            self.skip("late code join: missing E2E_LATE_STUDENT_TOKEN")
        items = self.class_items("STUDENT", cid)
        for skill, action in (("grammar", self.grammar), ("listening", self.listening)):
            if skill not in assignments:
                continue
            item = next((r for r in items if r["assignment"]["id"] == assignments[skill]), None)
            check(item is not None, "Given task is absent from learner assignments")
            action(item)
            # Refetch twice: immediate canonical state and a fresh page-equivalent read.
            for _ in range(2):
                persisted = next(r for r in self.class_items("STUDENT", cid)
                                 if r["assignment"]["id"] == assignments[skill])
                check(bool(persisted.get("submitted_at")), "Learner class ledger did not record submission")
            tally = self.call("ADMIN", "GET", f"/admin/cohorts/{cid}/assignments/{assignments[skill]}/tally")
            check(not tally.get("homework_stale") and tally["counts"]["submitted"] == 1,
                  "Admin tally disagrees with persisted learner submission")
        print("PARTIAL: fixture grading coverage is incomplete; run --cleanup with this run-id")
        return 2

    def cleanup(self):
        if "ADMIN" not in self.config.tokens or "INSTRUCTOR" not in self.config.tokens:
            self.skip("cleanup requires E2E_ADMIN_TOKEN and E2E_INSTRUCTOR_TOKEN")
            return 2
        self.identity("ADMIN")
        self.identity("INSTRUCTOR")
        instructor_cohorts = self.call("INSTRUCTOR", "GET", "/instructor/cohorts")
        owned_ids = {row_id(r) for r in instructor_cohorts if self.owned(r, "name")}
        cohorts = self.cohorts()
        check(all(row_id(r) in owned_ids for r in cohorts), "Cleanup cohort is not owned by the supplied instructor")
        for cohort in cohorts:
            cid = row_id(cohort)
            assignments = self.call("ADMIN", "GET", f"/admin/cohorts/{cid}/assignments")
            for row in assignments["assignments"]:
                check(self.owned(row, "title"), "Cleanup refused a class task without this run's marker")
                path = f"/admin/cohorts/{cid}/assignments/{row_id(row)}"
                after = self.call("ADMIN", "PATCH", path, {"status": "archived"})
                check(after.get("status") == "archived", "Cleanup did not archive a class task")
            writing = self.call("INSTRUCTOR", "GET", "/instructor/assignments")
            for row in writing:
                if row.get("cohort_id") == cid:
                    check(self.owned(row, "name"), "Cleanup refused unmarked Writing assignment")
                    # Backend refuses started work/drafts; never bypass that guard.
                    self.call("INSTRUCTOR", "DELETE", "/instructor/assignments/" + row_id(row))
            for code in self.call("INSTRUCTOR", "GET", "/instructor/codes"):
                if code.get("cohort_id") != cid:
                    continue
                check(self.owned(code, "notes"), "Cleanup refused an unmarked join code")
                code_path = "/admin/access-codes/" + row_id(code)
                detail = self.call("ADMIN", "GET", code_path)
                check(not detail.get("association_lookup_failed"), "Cleanup cannot verify code associations")
                for assignment in detail["assignments"]:
                    if assignment.get("is_active"):
                        check((assignment.get("display_name") or "").startswith("QA TEST"),
                              "Cleanup refused a code assigned to a non-QA identity")
                        uid = str(UUID(assignment["user_id"]))
                        self.call("ADMIN", "DELETE", code_path + "/users/" + uid)
                self.call("ADMIN", "DELETE", code_path)
                after = self.call("ADMIN", "GET", code_path)
                check(not after.get("association_lookup_failed")
                      and not any(a.get("is_active") for a in after["assignments"])
                      and after.get("is_revoked") is True
                      and all(after.get(k) == detail.get(k) for k in ("is_used", "used_by", "used_at")),
                      "Cleanup changed redemption history or failed to revoke code")
            members = self.call("ADMIN", "GET", f"/admin/cohorts/{cid}/members")["members"]
            for member in members:
                check((member.get("name") or "").startswith("QA TEST"), "Cleanup refused a non-QA class member")
                sid = str(UUID(member["student_id"]))
                self.call("ADMIN", "DELETE", f"/admin/cohorts/{cid}/students/{sid}")
            after = self.call("ADMIN", "PATCH", f"/admin/cohorts/{cid}", {"is_active": False})
            check(after.get("is_active") is False, "Cleanup did not archive the class")
            after = self.call("INSTRUCTOR", "GET", f"/instructor/cohorts/{cid}")
            check(after.get("is_active") is False, "Archived class differs after refetch")
            check(not self.call("ADMIN", "GET", f"/admin/cohorts/{cid}/members")["members"],
                  "Cleanup did not remove class memberships")
            after = self.call("ADMIN", "GET", f"/admin/cohorts/{cid}/assignments")
            check(not after.get("reconcile_failed") and all(r.get("status") == "archived" for r in after["assignments"]),
                  "Archived tasks differ after refetch")
            check(not any(r.get("cohort_id") == cid for r in self.call("INSTRUCTOR", "GET", "/instructor/assignments")),
                  "Deleted Writing assignments reappeared after refetch")
        for prompt in self.call("INSTRUCTOR", "GET", "/instructor/prompts"):
            if self.owned(prompt, "title"):
                self.call("INSTRUCTOR", "PATCH", "/instructor/prompts/" + row_id(prompt), {"is_active": False})
                after = self.call("INSTRUCTOR", "GET", "/instructor/prompts/" + row_id(prompt))
                check(after.get("is_active") is False, "Cleanup did not archive the Writing prompt")
        print(f"PASS cleanup: matched classes={len(cohorts)}; tasks/class/prompts archived, unstarted Writing removed, codes revoked; evidence retained")
        return 0


def dry_run(config, marker, cleanup=False):
    print(f"DRY-RUN {marker} -> {config.base_url}; network requests=0")
    for role in ROLES:
        print(("READY " if role in config.tokens else "SKIP missing ") + f"E2E_{role}_TOKEN")
    if cleanup:
        print("PLAN --cleanup: discover exact run marker; archive class tasks/prompts/class; remove unstarted Writing; revoke run codes; remove memberships; verify")
        return
    print("PLAN verify provisioned QA TEST profiles and instructor-owned student records; create marked QA class")
    print("PLAN mint marked code -> early join -> instructor Writing give -> QA admin Speaking/Grammar/Listening gives")
    print("PLAN late code join -> verify automatic Writing backfill -> explicitly backfill other skills")
    print("PLAN Grammar choice=0 and Listening marked answer -> deterministic grading -> refetch learner ledger and admin tally")
    print("SKIP Writing submit/grading: submit enqueues paid AI; no Writing fixture exists")
    print("SKIP Speaking submit/grading: server GRADING_PROVIDER_MODE=fixture has no remotely verifiable attestation")
    for name, value in (("E2E_SPEAKING_TOPIC_ID", config.speaking_topic), ("E2E_LISTENING_TEST_ID", config.listening_test)):
        if not value:
            print("SKIP corresponding give/submit: missing " + name)
    print("PLAN --cleanup --run-id <same-id>; submitted evidence and immutable redemption history remain archived")
    print("PARTIAL until safe server fixtures are available; dry-run is not live acceptance")


def main(argv=None, env=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--run-id", help="Required for cleanup; fresh ID for each live run")
    args = parser.parse_args(argv)
    try:
        check(not args.cleanup or bool(args.run_id), "--cleanup requires the original --run-id")
        marker = run_marker(args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + secrets.token_hex(4))
        config = Config.from_env(os.environ if env is None else env)
        if args.dry_run:
            dry_run(config, marker, args.cleanup)
            return 0
        print("RUN " + marker)
        journey = Journey(config, marker)
        return journey.cleanup() if args.cleanup else journey.run()
    except Stop as exc:
        print("STOP " + str(exc), file=sys.stderr)
        return 3
    except (KeyError, TypeError, ValueError, AttributeError, IndexError, StopIteration):
        print("STOP API contract mismatch; no retry; inspect run-owned state before cleanup", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
