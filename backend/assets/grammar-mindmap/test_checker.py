# -*- coding: utf-8 -*-
"""Tests for the grammar checker — both incorrect (must catch) and correct
(must NOT produce false positives) sentences."""

import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from grammar_checker import (
    run_local_rules, merge_findings, chained_correct, LTBackend, auto_correct
)

INCORRECT = [
    ("She go to school every day.", "Subject-verb agreement"),
    ("He don't like coffee.", "do/does"),
    ("I beautiful.", "Linking verbs"),
    ("They was happy yesterday.", "was/were"),
    ("Did you went to the party?", "did + base"),
    ("If it will rain, I will stay home.", "Conditional"),
    ("If it will rain tomorrow, I stay home.", "Conditional"),
    ("I have many informations.", "Uncountable plural"),
    ("She is more taller than him.", "Double comparative"),
    ("I can to swim.", "Modal + to"),
    ("He must goes home now.", "Modal + V-s"),
    ("Your welcome to come.", "your vs you're"),
    ("She is the a best student.", "Two articles"),
    ("I am study English now.", "be + V-ing missing"),
    ("He have lived here for 5 years.", "have/has"),
    ("Yesterday I go to the market.", "Past time marker"),
    ("Yesterday I have eaten lunch.", "Past time marker"),   # PP + finished-past marker
    ("Last year I have worked in London.", "Past time marker"),
    ("I am agree with you.", "be + agree"),
    ("People is happy.", "people are"),
    ("Where you are going?", "Question word order"),
    ("I born in 1990.", "born + be"),
    ("Discuss about the issue.", "discuss about"),
    ("They marry with each other last year.", "marry with"),
    ("Listen music every night.", "listen to music"),
    ("Despite of the rain, we went out.", "despite of"),
    ("There are less people here than yesterday.", "fewer vs less"),
    ("He don't goes to work.", "chained: don't + V-s"),
    ("She do not like coffee.", "do not + V"),
    ("He has went home.", "has + V2"),
    ("I am listen to music.", "am + V (base, not V-ing)"),
    ("I am go to school.", "am go (continuous missing)"),
]

# Correct sentences MUST NOT produce false positives
CORRECT = [
    "She goes to school every day.",
    "He doesn't like coffee.",
    "I am beautiful.",
    "They were happy yesterday.",
    "Did you go to the party?",
    "If it rains, I will stay home.",
    "I have a lot of information.",
    "She is taller than him.",
    "I can swim.",
    "He must go home now.",
    "You're welcome to come.",
    "She is the best student.",
    "I am studying English now.",
    "He has lived here for 5 years.",
    "Yesterday I went to the market.",
    "I agree with you.",
    "People are happy.",
    "Where are you going?",
    "I was born in 1990.",
    "We discussed the issue.",
    "They married last year.",
    "Listen to music every night.",
    "Despite the rain, we went out.",
    "There are fewer people here than yesterday.",
    # Some trickier correct sentences
    "She put the book on the shelf.",       # 'put' is V3 = base, NOT continuous
    "I read this book yesterday.",          # 'read' past = base form
    "He looks tired.",                       # look + Adj is linking, no missing 'be'
    "The soup tastes good.",                 # linking V
    "I would like a cup of coffee.",
    "She is more intelligent than him.",     # 'more intelligent' is correct (multi-syllable)
    "The dog ran fast.",                     # past simple
    "I can speak three languages.",
    "He suggested I leave early.",           # subjunctive
    "Time flies when you're having fun.",
    "It's such a beautiful day.",
    "She studies hard every day.",
    "We had to leave early.",
    "He was reading when I came in.",        # past continuous, OK
    "The book was written by him.",          # passive — should NOT trigger be + V-ing
    # V3=base verb regression
    "He read the book last night.",          # read past = base
    "She put it on the table.",               # put past = base
    "I cut my finger yesterday.",             # cut past = base
    "He has gone home.",                       # correct PP
    "She has eaten lunch.",                    # correct PP
    "I am listening to music.",                # correct continuous
    "I am going to the store.",                # correct continuous
    # Codex review on #1695
    "I wonder if he will come.",               # if = whether (embedded question)
    "I'm not sure if she will agree.",
    "Since last year I have lived here.",      # since-phrase → present perfect
    "In the last year I have been very busy.", # in the last … → present perfect
    "in the last year I have lived here",
]


def test_incorrect():
    print("=" * 72)
    print("TEST 1: INCORRECT SENTENCES (must catch ≥ 1 error each)")
    print("=" * 72)
    fail = 0
    for s, label in INCORRECT:
        local = run_local_rules(s)
        merged = merge_findings(s, [], local)
        ok = "✓" if merged else "✗"
        if not merged:
            fail += 1
        n = len(merged)
        first = merged[0]["_tip"]["point"] if merged else "-"
        print(f"  {ok} [{label:>30s}] {s}")
        print(f"      → {n} finding(s); first: {first}")
    print(f"\nResult: {len(INCORRECT)-fail}/{len(INCORRECT)} sentences correctly flagged ({fail} missed).")
    return fail


def test_correct():
    print("\n" + "=" * 72)
    print("TEST 2: CORRECT SENTENCES (must NOT produce false positives)")
    print("=" * 72)
    fail = 0
    for s in CORRECT:
        local = run_local_rules(s)
        ok = "✓" if not local else "✗ FALSE POSITIVE"
        if local:
            fail += 1
        details = ""
        if local:
            details = "  ".join(f"[{f['_tip']['point']}: «{s[f['offset']:f['offset']+f['errorLength']]}»]" for f in local[:3])
        print(f"  {ok}  {s}")
        if details:
            print(f"      → {details}")
    print(f"\nResult: {len(CORRECT)-fail}/{len(CORRECT)} clean ({fail} false positives).")
    return fail


def test_chained():
    print("\n" + "=" * 72)
    print("TEST 3: CHAINED ERROR CORRECTION")
    print("=" * 72)
    chained_cases = [
        ("He don't goes to school.", "He doesn't go to school."),
        ("She don't likes coffee.", "She doesn't like coffee."),
    ]
    fail = 0
    for s, expected in chained_cases:
        final, history = chained_correct(s, backend=None, max_iters=3)
        ok = "✓" if final.strip().lower() == expected.strip().lower() else "✗"
        if ok == "✗":
            fail += 1
        print(f"  {ok}  {s}  →  {final}")
        print(f"      (expected: {expected}; iterations: {len(history)})")
    return fail


if __name__ == "__main__":
    f1 = test_incorrect()
    f2 = test_correct()
    f3 = test_chained()
    total = f1 + f2 + f3
    print("\n" + "=" * 72)
    print(f"TOTAL FAILURES: {total}  (incorrect-missed={f1}, false-positives={f2}, chained-fail={f3})")
    sys.exit(1 if total > 0 else 0)
