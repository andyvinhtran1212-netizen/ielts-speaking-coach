# Rollout and reversal

This draft describes a future rollout. Obtain product approval for the spec before implementation. Migration 510 is a separate draft in #2717. Obtain current, environment-specific approval before application. Apply and verify its nullable columns before deploying readers with explicit column selects. Run staging acceptance on synthetic sittings on the Mac mini in Browser 1.

Production application, any hotfix promotion, and action on the affected sitting require their respective authorization. Andy performs the manual release. For rollback, withdraw the action and revert dependent readers before considering schema reversal. Preserve existing decisions, reason/by/at and released results. If a sitting has been marked, review affected records and agree a data-preserving recovery before removing columns or restoring Writing requirements.
