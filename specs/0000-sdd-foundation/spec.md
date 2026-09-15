---
id: SDD-0000
title: Lean spec-driven development foundation
status: shipped
risk: medium
owner: platform
---

# Lean spec-driven development foundation

## Problem

Product intent is spread across hundreds of discovery, audit, migration, and
handoff documents. Existing invariants, OpenAPI generation, tests, and release
gates are strong, but there is no canonical feature lifecycle that tells a
developer or agent which requirements are active and how they map to evidence.

## Scope

- Establish an Aver Learning constitution and proportionate change classes.
- Provide canonical templates and a machine-validated feature lifecycle.
- Require feature/high-risk pull requests to reference an approved spec.
- Make spec validation part of an existing integrated release workflow.
- Correct top-level documentation that still describes the retired HTML
  production architecture.

## Non-goals

- Installing or depending on an external SDD CLI.
- Retrofitting specs onto every shipped route or historical feature.
- Changing application behavior, API payloads, database schema, or deployment
  topology.
- Selecting the first product-feature pilot.

## Users and journeys

- A product owner can approve observable behavior before code is written.
- A coding agent can identify scope, contracts, tasks, and evidence without
  treating migration history as active requirements.
- A reviewer can trace each functional requirement to verification.
- Parallel sessions can use separate worktrees and explicit file ownership.

## Requirements

- **FR-001:** The repository defines a versioned engineering constitution that
  reflects the current Next.js, FastAPI, Supabase, staging-first architecture.
- **FR-002:** The repository provides templates for specification, plan, tasks,
  verification, UI states, and rollout/rollback.
- **FR-003:** Canonical feature directories and metadata are validated for
  naming, required files, lifecycle state, requirement IDs, and evidence.
- **FR-004:** A verified or shipped feature cannot retain incomplete required
  tasks or requirements without result-specific final evidence.
- **FR-005:** Pull requests declare a change class and exact requirement
  coverage; feature and high-risk PRs reference a spec approved in the base
  revision without mutating its requirements or approved risk, and approved
  high/critical specs require the high-risk change class; spec-free changes
  include problem, expected behavior, scope, and verification;
  unambiguous migration paths cannot be downgraded through PR metadata;
  staging-to-main promotions remain exempt from duplicate feature metadata.
  SDD-0000 is the one-time bootstrap exception.
- **FR-006:** Spec validation runs in a dedicated unfiltered workflow required
  by the staging promotion gate; PR-body edits cannot shadow TypeScript or
  OpenAPI failures on the same SHA.
- **FR-007:** Top-level agent documentation identifies Next.js App Router as the
  deployed frontend and does not direct work to retired HTML pages.
- **FR-008:** The foundation is isolated from active product work and changes no
  application runtime, API, database, or deployment topology; only repository
  governance and release validation change.

## Acceptance scenarios

### Feature PR without a spec

- **Given** a pull request classified as `feature`
- **When** its body contains `Spec: N/A` or an unknown identifier
- **Then** spec validation fails with an actionable message.

### Small fix without a full spec

- **Given** a pull request classified as `small`
- **When** its body contains `Spec: N/A`
- **Then** governance validation passes while existing review/test rules remain.

### Production promotion

- **Given** a pull request from repository branch `staging` to `main`
- **When** the spec validator reads the GitHub event
- **Then** it validates repository artifacts but does not require a duplicate
  feature spec for the promotion PR.

### Incomplete verified feature

- **Given** a feature whose metadata says `verified`
- **When** `tasks.md` has an unchecked task or `verification.md` lacks final
  evidence for a declared requirement
- **Then** validation fails.

## Edge cases

- Template placeholders are not interpreted as active features.
- Binary/non-JSON endpoints are not forced into JSON response contracts.
- Historical documents remain available but cannot silently override active
  specs.
- Concurrent product worktrees are not checked out, rebased, or modified.

## Success criteria

- Repository-wide spec validation passes locally and in CI.
- Validator tests cover valid, invalid, exempt, and lifecycle cases.
- Existing backend/frontend, OpenAPI, route, and staging gates are unchanged.
- The next product feature can be specified without inventing a new document
  structure.

## Open questions

- The first product-feature pilot will be selected from the next approved
  cross-stack feature; this platform foundation does not invent product scope.
