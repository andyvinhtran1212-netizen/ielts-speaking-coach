# UI state matrix

UI impact: N/A — no page, component or response shape changes. Direct PostgREST writes are refused at the database. Speaking question generation, grading and pronunciation can now return 403 for an inactive or unentitled account; the player's existing request-error state renders it, with the same detail strings POST `/sessions` already returns.
