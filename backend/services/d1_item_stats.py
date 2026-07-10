"""d1_item_stats — item difficulty + discrimination for D1 exercises
(audit Giai đoạn 3, #7 vocab: "no metric measures whether learners actually
learn — per-item difficulty, discrimination index").

Pure functions over the attempt log (vocabulary_exercise_attempts). Two classic
item-analysis stats per exercise:

  * difficulty (p-value) = fraction of attempts answered correctly.
    ~0 = too hard, ~1 = too easy; a healthy item sits roughly 0.3–0.9.
  * discrimination = p(correct | high-ability users) − p(correct | low-ability
    users). High-ability = top group by overall accuracy, low = bottom group.
    ≥ 0.3 good, < 0.2 weak, < 0 BROKEN (weak students beat strong ones ⇒ likely
    a wrong key or an ambiguous distractor).

These flag items to fix or retire. Ability uses each user's overall accuracy
(incl. the item itself — a mild, well-known inflation that's fine for screening,
not high-stakes scoring). No IO; fully unit-tested.
"""

from __future__ import annotations

from collections import defaultdict

TOO_EASY = 0.95
TOO_HARD = 0.20
WEAK_DISCRIMINATION = 0.20


def item_stats(attempts: list[dict], *, group_frac: float = 0.27, min_attempts: int = 5) -> dict:
    """Per-exercise stats from attempts (each: {user_id, exercise_id, is_correct}).

    Returns {exercise_id: {n, difficulty, discrimination, flags}}. discrimination
    is None when there aren't distinct high/low groups that both attempted the item.
    """
    # ── per-user ability = overall accuracy ──────────────────────────────────
    per_user: dict = defaultdict(lambda: [0, 0])  # user -> [correct, total]
    for a in attempts:
        per_user[a["user_id"]][1] += 1
        if a.get("is_correct"):
            per_user[a["user_id"]][0] += 1
    ability = {u: (c / t if t else 0.0) for u, (c, t) in per_user.items()}

    users_sorted = sorted(ability, key=lambda u: ability[u])
    n_users = len(users_sorted)
    # disjoint top/bottom groups: k ≤ n//2 guarantees no user is in both
    k = min(max(1, int(n_users * group_frac)), n_users // 2)
    lower = set(users_sorted[:k]) if k else set()
    upper = set(users_sorted[n_users - k:]) if k else set()

    # ── per-item aggregation ─────────────────────────────────────────────────
    by_item: dict = defaultdict(list)  # exercise_id -> [(user_id, is_correct), …]
    for a in attempts:
        by_item[a["exercise_id"]].append((a["user_id"], bool(a.get("is_correct"))))

    out: dict = {}
    for ex, rows in by_item.items():
        n = len(rows)
        difficulty = sum(1 for _, c in rows if c) / n if n else None

        up = [c for u, c in rows if u in upper]
        lo = [c for u, c in rows if u in lower]
        disc = (sum(up) / len(up) - sum(lo) / len(lo)) if up and lo else None

        flags: list[str] = []
        if n < min_attempts:
            flags.append("low_n")
        if difficulty is not None:
            if difficulty > TOO_EASY:
                flags.append("too_easy")
            elif difficulty < TOO_HARD:
                flags.append("too_hard")
        if disc is not None:
            if disc < 0:
                flags.append("negative_discrimination")
            elif disc < WEAK_DISCRIMINATION:
                flags.append("weak_discrimination")

        out[ex] = {
            "n": n,
            "difficulty": round(difficulty, 3) if difficulty is not None else None,
            "discrimination": round(disc, 3) if disc is not None else None,
            "flags": flags,
        }
    return out
