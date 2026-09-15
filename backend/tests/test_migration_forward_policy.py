import os
from pathlib import Path
import shutil
import subprocess


BACKEND = Path(__file__).resolve().parents[1]
POLICY = BACKEND / "migrations" / "forward-policy.tsv"
RUNNER = (BACKEND / "scripts" / "apply_migrations.sh").read_text(encoding="utf-8")
STAGING_CLONE = (
    BACKEND / "scripts" / "staging_clone_schema_from_prod.sh"
).read_text(encoding="utf-8")


def _policy() -> dict[str, tuple[str, str]]:
    rows: dict[str, tuple[str, str]] = {}
    for raw in POLICY.read_text(encoding="utf-8").splitlines():
        if not raw or raw.startswith("#"):
            continue
        filename, state, group, _reason = raw.split("\t", 3)
        assert filename not in rows
        assert (BACKEND / "migrations" / filename).is_file()
        rows[filename] = (state, group)
    return rows


def test_gate_f_only_schema_is_retired_from_the_forward_queue():
    policy = _policy()
    expected = {
        *(f"{number}_" for number in range(240, 245)),
        *(f"{number}_" for number in range(247, 257)),
    }
    retired = {
        filename[:4]
        for filename, state in policy.items()
        if state == ("retired", "-")
    }
    assert expected <= retired


def test_curated_vocabulary_requires_explicit_feature_opt_in():
    policy = _policy()
    pending = {
        filename[:4]
        for filename, state in policy.items()
        if state == ("pending_feature", "curated_vocab")
    }
    assert pending == {f"{number}_" for number in range(234, 240)}
    assert "MIGRATION_FEATURES" in RUNNER
    assert "pending_feature:$policy_group" in RUNNER


def test_active_mock_explanation_and_timed_course_migrations_are_not_policy_skipped():
    policy = _policy()
    for number in (*range(245, 247), *range(257, 278)):
        assert not any(name.startswith(f"{number}_") for name in policy)


def test_account_scoped_recovery_can_never_replay_automatically():
    policy = _policy()
    assert policy["233_recover_bao_quyen_course_retries.sql"] == (
        "retired", "-"
    )


def test_runner_validates_policy_before_contacting_the_database():
    policy_check = RUNNER.index("if ! awk -F '\\t'")
    database_contact = RUNNER.index('psql "$DB_URL"')
    assert policy_check < database_contact
    assert "migration forward policy references a missing file" in RUNNER


def test_malformed_policy_causes_zero_database_invocations(tmp_path):
    backend = tmp_path / "backend"
    scripts = backend / "scripts"
    migrations = backend / "migrations"
    scripts.mkdir(parents=True)
    migrations.mkdir()
    runner = scripts / "apply_migrations.sh"
    shutil.copy2(BACKEND / "scripts" / "apply_migrations.sh", runner)
    shutil.copy2(BACKEND / "scripts" / "apply_migration_locked.sql", scripts)
    migration = "001_example.sql"
    (migrations / migration).write_text("SELECT 1;\n", encoding="utf-8")
    (migrations / "forward-policy.tsv").write_text(
        "# filename\tstate\tgroup\treason\n"
        f"{migration}\tretired\t-\tfirst\n"
        f"{migration}\tinvalid\t-\tduplicate\n",
        encoding="utf-8",
    )
    marker = tmp_path / "psql-called"
    fake_psql = tmp_path / "psql"
    fake_psql.write_text(
        "#!/usr/bin/env bash\n"
        "touch \"$PSQL_MARKER\"\n"
        "exit 99\n",
        encoding="utf-8",
    )
    fake_psql.chmod(0o755)
    env = os.environ.copy()
    env.update({
        "PATH": f"{tmp_path}:{env['PATH']}",
        "PSQL_MARKER": str(marker),
    })

    result = subprocess.run(
        [str(runner), "postgresql://postgres:secret@staging.example/postgres"],
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 1
    assert "malformed or duplicate migration forward policy" in result.stderr
    assert not marker.exists()


def test_unknown_feature_opt_in_causes_zero_database_invocations(tmp_path):
    marker = tmp_path / "psql-called"
    fake_psql = tmp_path / "psql"
    fake_psql.write_text(
        "#!/usr/bin/env bash\n"
        "touch \"$PSQL_MARKER\"\n"
        "exit 99\n",
        encoding="utf-8",
    )
    fake_psql.chmod(0o755)
    env = os.environ.copy()
    env.update({
        "PATH": f"{tmp_path}:{env['PATH']}",
        "PSQL_MARKER": str(marker),
        "MIGRATION_FEATURES": "curated_vocb",
    })

    result = subprocess.run(
        [str(BACKEND / "scripts" / "apply_migrations.sh"),
         "postgresql://postgres:secret@staging.example/postgres"],
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 1
    assert "MIGRATION_FEATURES contains an unknown group: curated_vocb" in result.stderr
    assert not marker.exists()


def test_empty_feature_opt_in_causes_zero_database_invocations(tmp_path):
    marker = tmp_path / "psql-called"
    fake_psql = tmp_path / "psql"
    fake_psql.write_text(
        "#!/usr/bin/env bash\n"
        "touch \"$PSQL_MARKER\"\n"
        "exit 99\n",
        encoding="utf-8",
    )
    fake_psql.chmod(0o755)
    env = os.environ.copy()
    env.update({
        "PATH": f"{tmp_path}:{env['PATH']}",
        "PSQL_MARKER": str(marker),
        "MIGRATION_FEATURES": "curated_vocab,,future_group",
    })

    result = subprocess.run(
        [str(BACKEND / "scripts" / "apply_migrations.sh"),
         "postgresql://postgres:secret@staging.example/postgres"],
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 1
    assert "MIGRATION_FEATURES contains an empty or malformed group" in result.stderr
    assert not marker.exists()


def test_staging_clone_restores_and_verifies_the_pending_feature_group():
    assert "MIGRATION_FEATURES=curated_vocab" in STAGING_CLONE
    assert "curated vocabulary ledger incomplete" in STAGING_CLONE
    for table in (
        "vocab_learning_units",
        "vocab_unit_tasks",
        "vocab_unit_recommendations",
        "vocab_speaking_signal_maps",
        "vocab_context_lookup_terms",
    ):
        assert table in STAGING_CLONE


def _run_with_fake_ledger(tmp_path: Path, *, missing: set[str], features: str = ""):
    fake_psql = tmp_path / "psql"
    fake_psql.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" -tAc "* ]]; then
  printf '%s\\n' "$FAKE_LEDGER"
  exit 0
fi
if [[ " $* " == *"apply_migration_locked.sql"* ]]; then
  for arg in "$@"; do
    case "$arg" in
      MIGRATION_NAME=*) name="${arg#MIGRATION_NAME=}" ;;
    esac
  done
  printf 'would apply: %s\\n' "$name"
  printf '__apply_migration_status__=would-apply\\n'
fi
""",
        encoding="utf-8",
    )
    fake_psql.chmod(0o755)
    all_migrations = {
        path.name
        for path in (BACKEND / "migrations").glob("*.sql")
        if path.name != "032_rollback.sql"
    }
    env = os.environ.copy()
    env.update({
        "DRY_RUN": "1",
        "FAKE_LEDGER": "\n".join(sorted(all_migrations - missing)),
        "PATH": f"{tmp_path}:{env['PATH']}",
        "MIGRATION_FEATURES": features,
    })
    return subprocess.run(
        [str(BACKEND / "scripts" / "apply_migrations.sh"),
         "postgresql://postgres:secret@staging.example/postgres"],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    ).stdout


def _would_apply_files(output: str) -> set[str]:
    return {
        line.removeprefix("would apply: ")
        for line in output.splitlines()
        if line.startswith("would apply: ") and line.endswith(".sql")
    }


def test_runner_skips_retired_and_pending_migrations_by_default(tmp_path):
    policy = _policy()
    missing = set(policy) | {
        "262_restore_cambridge_15_test_4_reading_q07_explanation.sql"
    }

    output = _run_with_fake_ledger(tmp_path, missing=missing)

    assert _would_apply_files(output) == {
        "262_restore_cambridge_15_test_4_reading_q07_explanation.sql"
    }
    assert "policy skip: 240_core_attempt_evidence.sql [retired]" in output
    assert "policy skip: 234_vocab_curated_identity_and_editorial.sql [pending_feature:curated_vocab]" in output


def test_runner_requires_named_opt_in_for_a_pending_feature(tmp_path):
    pending = {
        filename
        for filename, state in _policy().items()
        if state == ("pending_feature", "curated_vocab")
    }

    output = _run_with_fake_ledger(
        tmp_path,
        missing=pending,
        features="curated_vocab",
    )

    assert _would_apply_files(output) == pending
    assert "pending_feature:curated_vocab" not in output
    for filename in pending:
        assert f"would apply: {filename}" in output
