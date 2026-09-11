"""Executable PG primitives for CORE_ADMISSION_LEDGER_DESIGN.md, not an RPC implementation.

Only isolated local fixture tables are used. These tests prove transaction/lock
assumptions, not route enrollment, auth, admission policy or production coverage.
"""

import asyncio
from uuid import uuid4

import asyncpg
import pytest

from test_migration_240_core_attempt_evidence import DB, probe, psql


@pytest.fixture(scope="module")
def design_schema(probe):
    psql(f"""
        CREATE TABLE {probe}.design_epochs(id uuid PRIMARY KEY, state text NOT NULL);
        CREATE TABLE {probe}.design_commands(
            id uuid PRIMARY KEY, epoch_id uuid REFERENCES {probe}.design_epochs(id),
            generation integer NOT NULL DEFAULT 0, phase text NOT NULL DEFAULT 'accepted'
        );
        CREATE TABLE {probe}.design_product(id uuid PRIMARY KEY);
        CREATE TABLE {probe}.design_bindings(
            command_id uuid PRIMARY KEY REFERENCES {probe}.design_commands(id),
            product_id uuid NOT NULL UNIQUE REFERENCES {probe}.design_product(id)
        );
        CREATE TABLE {probe}.design_scopes(id uuid PRIMARY KEY);
        CREATE TABLE {probe}.design_episodes(
            id uuid PRIMARY KEY,
            scope_id uuid NOT NULL UNIQUE REFERENCES {probe}.design_scopes(id),
            first_epoch_id uuid NOT NULL REFERENCES {probe}.design_epochs(id)
        );
        CREATE TABLE {probe}.design_resume_commands(
            id uuid PRIMARY KEY,
            episode_id uuid NOT NULL REFERENCES {probe}.design_episodes(id),
            activity_epoch_id uuid NOT NULL REFERENCES {probe}.design_epochs(id)
        );
        CREATE FUNCTION {probe}.design_keep_first_epoch() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.first_epoch_id IS DISTINCT FROM OLD.first_epoch_id THEN
                RAISE EXCEPTION 'immutable_first_epoch' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER design_keep_first_epoch BEFORE UPDATE OF first_epoch_id
            ON {probe}.design_episodes FOR EACH ROW
            EXECUTE FUNCTION {probe}.design_keep_first_epoch();
    """)
    return probe


async def wait_blocked(blocker, waiter, task):
    async with asyncio.timeout(3):
        while not await blocker.fetchval("SELECT $1 = ANY(pg_blocking_pids($2))",
                                         blocker.get_server_pid(), waiter.get_server_pid()):
            assert not task.done(), "expected an observed database lock overlap"
            await asyncio.sleep(0.01)


def test_epoch_close_waits_for_admission_commit_and_late_writer_sees_closed(design_schema):
    async def run():
        writer, closer = await asyncpg.connect(DB), await asyncpg.connect(DB)
        epoch, command = uuid4(), uuid4()
        task = None
        try:
            await writer.execute(f"INSERT INTO {design_schema}.design_epochs VALUES ($1,'open')", epoch)
            async with writer.transaction(isolation="read_committed"):
                assert await writer.fetchval(f"SELECT state FROM {design_schema}.design_epochs WHERE id=$1 FOR SHARE", epoch) == "open"
                await writer.execute(f"INSERT INTO {design_schema}.design_commands(id,epoch_id) VALUES ($1,$2)", command, epoch)

                async def close():
                    async with closer.transaction(isolation="read_committed"):
                        await closer.fetchrow(f"SELECT * FROM {design_schema}.design_epochs WHERE id=$1 FOR UPDATE", epoch)
                        await closer.execute(f"UPDATE {design_schema}.design_epochs SET state='closed' WHERE id=$1", epoch)

                task = asyncio.create_task(close())
                await wait_blocked(writer, closer, task)
            await asyncio.wait_for(task, 3)
            # A fresh snapshot after closure includes the previously pending A.
            assert await closer.fetchval(f"SELECT count(*) FROM {design_schema}.design_commands WHERE epoch_id=$1", epoch) == 1
            async with writer.transaction(isolation="read_committed"):
                # Even a caller holding the old epoch ID must recheck under lock.
                assert await writer.fetchval(f"SELECT state FROM {design_schema}.design_epochs WHERE id=$1 FOR SHARE", epoch) == "closed"
                assert await writer.fetchrow(f"SELECT id FROM {design_schema}.design_epochs WHERE id=$1 AND state='open' FOR SHARE", epoch) is None
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await closer.close()
            await writer.close()
    asyncio.run(run())


def test_product_and_binding_rollback_together_then_readback_survives_disconnect(design_schema):
    async def run():
        connection = await asyncpg.connect(DB)
        command, product = uuid4(), uuid4()
        try:
            await connection.execute(f"INSERT INTO {design_schema}.design_commands(id) VALUES ($1)", command)
            with pytest.raises(asyncpg.ForeignKeyViolationError):
                async with connection.transaction():
                    await connection.execute(f"INSERT INTO {design_schema}.design_product VALUES ($1)", product)
                    await connection.execute(f"INSERT INTO {design_schema}.design_bindings VALUES ($1,$2)", uuid4(), product)
            assert await connection.fetchval(f"SELECT count(*) FROM {design_schema}.design_product WHERE id=$1", product) == 0
            assert await connection.fetchval(f"SELECT count(*) FROM {design_schema}.design_bindings WHERE command_id=$1", command) == 0
            assert await connection.fetchval(f"SELECT phase FROM {design_schema}.design_commands WHERE id=$1", command) == "accepted"
            async with connection.transaction():
                await connection.fetchrow(f"SELECT * FROM {design_schema}.design_commands WHERE id=$1 FOR UPDATE", command)
                await connection.execute(f"INSERT INTO {design_schema}.design_product VALUES ($1)", product)
                await connection.execute(f"INSERT INTO {design_schema}.design_bindings VALUES ($1,$2)", command, product)
                await connection.execute(f"UPDATE {design_schema}.design_commands SET phase='bound' WHERE id=$1", command)
        finally:
            await connection.close()
        fresh = await asyncpg.connect(DB)
        try:
            row = await fresh.fetchrow(f"SELECT c.phase,b.product_id FROM {design_schema}.design_commands c JOIN {design_schema}.design_bindings b ON b.command_id=c.id WHERE c.id=$1", command)
            assert row["phase"] == "bound" and row["product_id"] == product
        finally:
            await fresh.close()
    asyncio.run(run())


def test_reconciler_generation_fences_waiting_stale_executor(design_schema):
    async def run():
        reconciler, executor = await asyncpg.connect(DB), await asyncpg.connect(DB)
        command = uuid4()
        task = None
        try:
            await reconciler.execute(f"INSERT INTO {design_schema}.design_commands(id) VALUES ($1)", command)
            old_generation = await executor.fetchval(f"SELECT generation FROM {design_schema}.design_commands WHERE id=$1", command)
            async with reconciler.transaction(isolation="read_committed"):
                await reconciler.fetchrow(f"SELECT * FROM {design_schema}.design_commands WHERE id=$1 FOR UPDATE", command)
                await reconciler.execute(f"UPDATE {design_schema}.design_commands SET generation=generation+1,phase='closed' WHERE id=$1", command)
                task = asyncio.create_task(executor.fetchrow(
                    f"UPDATE {design_schema}.design_commands SET phase='executing' WHERE id=$1 AND generation=$2 AND phase='accepted' RETURNING id",
                    command, old_generation))
                await wait_blocked(reconciler, executor, task)
            assert await asyncio.wait_for(task, 3) is None
            row = await executor.fetchrow(f"SELECT generation,phase FROM {design_schema}.design_commands WHERE id=$1", command)
            assert row["generation"] == old_generation + 1 and row["phase"] == "closed"
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await executor.close()
            await reconciler.close()
    asyncio.run(run())


@pytest.mark.parametrize("commit_first", [True, False], ids=["first-commit", "first-rollback"])
def test_concurrent_resume_has_one_first_epoch_even_after_epoch_rollover(design_schema, commit_first):
    """Prototype scope→epoch order, not the product's full lock/ownership protocol.

    A rollback must leave neither an episode nor its command. A committed first
    admission must keep its cohort when a later command resumes in another epoch.
    """
    async def run():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        scope, old_epoch, next_epoch = uuid4(), uuid4(), uuid4()
        first_command, second_command, later_command = uuid4(), uuid4(), uuid4()
        task = None

        async def prepare(connection, epoch, command):
            # Scope is an existing server-owned reservation in this prototype.
            await connection.fetchrow(
                f"SELECT id FROM {design_schema}.design_scopes WHERE id=$1 FOR UPDATE", scope)
            state = await connection.fetchval(
                f"SELECT state FROM {design_schema}.design_epochs WHERE id=$1 FOR SHARE", epoch)
            assert state == "open"
            episode = await connection.fetchval(
                f"SELECT id FROM {design_schema}.design_episodes WHERE scope_id=$1", scope)
            if episode is None:
                episode = uuid4()
                await connection.execute(
                    f"INSERT INTO {design_schema}.design_episodes VALUES ($1,$2,$3)",
                    episode, scope, epoch)
            await connection.execute(
                f"INSERT INTO {design_schema}.design_resume_commands VALUES ($1,$2,$3)",
                command, episode, epoch)
            return episode

        try:
            await first.execute(f"INSERT INTO {design_schema}.design_scopes VALUES ($1)", scope)
            await first.execute(f"INSERT INTO {design_schema}.design_epochs VALUES ($1,'open')", old_epoch)
            transaction = first.transaction(isolation="read_committed")
            await transaction.start()
            initial_episode = await prepare(first, old_epoch, first_command)

            async def concurrent_prepare():
                async with second.transaction(isolation="read_committed"):
                    return await prepare(second, old_epoch, second_command)

            task = asyncio.create_task(concurrent_prepare())
            await wait_blocked(first, second, task)
            if commit_first:
                await transaction.commit()
            else:
                await transaction.rollback()
            surviving_episode = await asyncio.wait_for(task, 3)
            assert (surviving_episode == initial_episode) is commit_first
            assert await first.fetchval(
                f"SELECT count(*) FROM {design_schema}.design_resume_commands WHERE id=$1",
                first_command) == int(commit_first)
            assert await first.fetchval(
                f"SELECT count(*) FROM {design_schema}.design_episodes WHERE scope_id=$1", scope) == 1

            async with first.transaction():
                await first.execute(
                    f"UPDATE {design_schema}.design_epochs SET state='closed' WHERE id=$1", old_epoch)
                await first.execute(
                    f"INSERT INTO {design_schema}.design_epochs VALUES ($1,'open')", next_epoch)
            async with second.transaction(isolation="read_committed"):
                assert await prepare(second, next_epoch, later_command) == surviving_episode
            # Current command activity changes; admitted-episode membership does not.
            assert await first.fetchval(
                f"SELECT count(*) FROM {design_schema}.design_resume_commands WHERE activity_epoch_id=$1",
                next_epoch) == 1
            for epoch, expected in [(old_epoch, 1), (next_epoch, 0)]:
                assert await first.fetchval(
                    f"SELECT count(*) FROM {design_schema}.design_episodes WHERE first_epoch_id=$1",
                    epoch) == expected
            with pytest.raises(asyncpg.CheckViolationError, match="immutable_first_epoch"):
                await first.execute(
                    f"UPDATE {design_schema}.design_episodes SET first_epoch_id=$1 WHERE id=$2",
                    next_epoch, surviving_episode)
            assert await first.fetchval(
                f"SELECT first_epoch_id FROM {design_schema}.design_episodes WHERE id=$1",
                surviving_episode) == old_epoch
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await second.close()
            await first.close()
    asyncio.run(run())
