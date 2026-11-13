"""Disposable loopback PG17, synthetic fixtures, durable per-group SQL receipts.

No external connection strings or credential files are consumed. Enable with
NAMESPACE_PG17_TESTS=1 and NAMESPACE_PG_LOG_DIR pointing to the job's log.d.
Every group starts and stops its own scram cluster and removes its data files.
"""
from __future__ import annotations

import ast
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import time

import pytest

MIG = Path(__file__).resolve().parents[1] / "migrations"
BIN = Path("/usr/lib/postgresql/17/bin")
MA = "381_restricted_content_namespace.sql"
MB = "382_restricted_content_sql_readers.sql"


def migration(name):
    return (MIG / name).read_text(encoding="utf-8")


def bootstrap():
    """Reuse the established synthetic 306 schema; execute actual 306 unchanged.

    This is a focused dependency fixture, NOT a claim that every historical
    migration has been applied. Full-history inventory remains a release gate.
    Extract only the existing fixture's f-string, without importing app modules.
    """
    tree = ast.parse(Path(__file__).with_name("test_mock_paper_policy_postgres.py").read_text())
    probe = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_policy_probe")
    assignment = next(n for n in probe.body if isinstance(n, ast.Assign)
                      and any(isinstance(t, ast.Name) and t.id == "bootstrap" for t in n.targets))
    sql = eval(compile(ast.Expression(assignment.value), "306 fixture", "eval"),
               {"__builtins__": {}, "schema": "public"})
    sql = sql.replace("CREATE SCHEMA public;", "")
    sql = re.sub(r"DEFAULT(?=\d)", "DEFAULT ", sql)
    return """
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
""" + sql + """
ALTER TABLE public.listening_tests ADD PRIMARY KEY(id);
ALTER TABLE public.listening_test_attempts ADD PRIMARY KEY(id);
ALTER TABLE public.reading_tests ADD COLUMN course_level text;
ALTER TABLE public.listening_tests ADD COLUMN course_level text,
    ADD COLUMN programme_id text DEFAULT 'ielts', ADD COLUMN audio_assembly_mode text DEFAULT 'full_premixed',
    ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN content_package_id uuid;
ALTER TABLE public.listening_content ADD COLUMN source_test_id uuid REFERENCES public.listening_tests(id) ON DELETE SET NULL,
    ADD COLUMN parent_content_id uuid REFERENCES public.listening_content(id) ON DELETE SET NULL,
    ADD COLUMN status text DEFAULT 'draft';
ALTER TABLE public.listening_content ADD FOREIGN KEY(test_id) REFERENCES public.listening_tests(id) ON DELETE SET NULL;
ALTER TABLE public.listening_test_attempts ADD COLUMN created_at timestamptz DEFAULT now();
CREATE TABLE public.dictation_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id uuid REFERENCES public.listening_tests(id) ON DELETE SET NULL, test_id_external text,
    user_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.dictation_attempts(id uuid PRIMARY KEY, user_id uuid, test_id uuid, section_num int,
    status text, started_at timestamptz);
CREATE UNIQUE INDEX uq_dictation_attempts_one_active_section
    ON public.dictation_attempts(user_id,test_id,section_num) WHERE status='in_progress';
CREATE TABLE public.listening_content_packages(id uuid PRIMARY KEY,programme_id text,status text);
CREATE TABLE public.listening_lessons(id uuid PRIMARY KEY,programme_id text);
CREATE TABLE public.writing_prompts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text,
    course_level text, is_active boolean DEFAULT true, exam_only boolean DEFAULT false);
CREATE TABLE public.exam_content_cohorts(content_kind text,content_id uuid,cohort_id uuid);
ALTER TABLE public.mock_exams ADD COLUMN created_at timestamptz DEFAULT now();
""" + migration("306_mock_paper_policy_and_admission.sql") + """
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
GRANT INSERT,UPDATE,DELETE ON public.listening_tests, public.listening_content,
    public.listening_test_attempts, public.dictation_sessions TO service_role;
""" + migration("299_admin_exam_content_page.sql") + migration("301_admin_exam_content_page_snapshot.sql") + """
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', label; END IF;
END;
$$;
CREATE FUNCTION pg_temp.expect_state(command text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
    BEGIN EXECUTE command;
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE;
    END;
    IF actual IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'expected SQLSTATE %, got %', expected, COALESCE(actual, 'success');
    END IF;
END;
$$;
"""


class LocalPG17:
    def __init__(self, log_dir, group):
        self.log_dir = Path(log_dir).resolve()
        self.group = group + "-" + str(time.time_ns())
        self.data = self.log_dir / ("pg-17-" + self.group)
        self.result = self.log_dir / (self.group + ".result")
        self.job_log = Path(str(self.log_dir).removesuffix(".d"))
        self.password_file = self.log_dir / (self.group + ".pw")
        self.passfile = self.log_dir / (self.group + ".pgpass")
        self.running = False

    def receipt(self, kind, request, suffix=""):
        with self.job_log.open("a") as log:
            log.write(f"{kind} {request} {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}{suffix}\n")

    def call(self, args, request, *, environment=None):
        self.receipt("SENDING", request)
        with self.result.open("a") as output:
            result = subprocess.run(args, stdout=output, stderr=subprocess.STDOUT,
                                    env=environment, timeout=120)
        self.receipt("RESULT", request, f" exit={result.returncode} -> {self.result}")
        if result.returncode:
            pytest.fail(f"Local PG17 group failed; see {self.result} (exit {result.returncode})")

    def __enter__(self):
        self.log_dir.mkdir(parents=True, exist_ok=True)
        password = secrets.token_urlsafe(32)
        self.password_file.write_text(password + "\n")
        self.password_file.chmod(0o600)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.passfile.write_text(f"127.0.0.1:{self.port}:postgres:postgres:{password}\n")
        self.passfile.chmod(0o600)
        commands = [
            [str(BIN / "initdb"), "-D", str(self.data), "-U", "postgres", "--no-locale",
             "--encoding=UTF8", "--auth-host=scram-sha-256", "--auth-local=peer", "--pwfile", str(self.password_file)],
            [str(BIN / "pg_ctl"), "-D", str(self.data), "-l", str(self.result),
             "-o", f"-h 127.0.0.1 -p {self.port} -k ''", "-w", "start"],
        ]
        request = self.log_dir / (self.group + "-startup.json")
        request.write_text(json.dumps(commands, indent=2) + "\n")
        try:
            for command in commands:
                self.call(command, request)
            self.running = True
        except BaseException:
            self.__exit__(None, None, None)
            raise
        return self

    def psql(self, sql):
        request = self.log_dir / (self.group + ".sql")
        assert not request.exists(), "One exact SQL request per group; no blind retries"
        request.write_text(sql, encoding="utf-8")
        environment = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "PGHOST": "127.0.0.1",
                       "PGPORT": str(self.port), "PGUSER": "postgres", "PGDATABASE": "postgres",
                       "PGPASSFILE": str(self.passfile), "PGCONNECT_TIMEOUT": "5"}
        self.call([str(BIN / "psql"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", str(request)],
                  request, environment=environment)
        return self.result.read_text()

    def __exit__(self, *unused):
        if (self.data / "postmaster.pid").exists():
            command = [str(BIN / "pg_ctl"), "-D", str(self.data), "-w", "stop", "-m", "fast"]
            request = self.log_dir / (self.group + "-stop.json")
            request.write_text(json.dumps(command) + "\n")
            self.call(command, request)
        if self.data.exists():
            shutil.rmtree(self.data)
        self.password_file.unlink(missing_ok=True)
        self.passfile.unlink(missing_ok=True)
        with self.result.open("a") as output:
            output.write(f"CLEANUP stopped=true data_removed={not self.data.exists()} credentials_removed=true\n")


def local_pg17(group):
    if os.environ.get("NAMESPACE_PG17_TESTS") != "1":
        pytest.skip("Focused PG17 matrix requires NAMESPACE_PG17_TESTS=1 and a job log.d; no external DB is used")
    if not (BIN / "initdb").is_file() or not (BIN / "psql").is_file():
        pytest.skip("Local PostgreSQL 17 binaries unavailable; see recorded local namespace matrix evidence")
    log_dir = os.environ.get("NAMESPACE_PG_LOG_DIR", "")
    if not log_dir or not Path(log_dir).is_absolute() or not log_dir.endswith(".log.d"):
        pytest.fail("NAMESPACE_PG_LOG_DIR must be the absolute job .log.d (never /tmp)")
    return LocalPG17(log_dir, group)
