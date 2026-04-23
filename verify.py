import requests
import json
from bs4 import BeautifulSoup
import sys

articles_to_check = [
    ("advanced", "articles"),
    ("error-clinic", "missing-subjects"),
    ("error-clinic", "missing-main-verbs"),
    ("modifiers", "adverbs"),
    ("modifiers", "adjective-vs-adverb"),
    ("verb-patterns", "gerund-vs-infinitive"),
    ("parts-of-speech", "verbs"),
    ("parts-of-speech", "pronouns"),
    ("grammar-for-meaning", "academic-hedging")
]

# Fetch all slugs
try:
    cats = requests.get("http://localhost:8000/api/grammar/categories").json()
    all_slugs = set()
    for c in cats:
        for a in c.get("articles", []):
            all_slugs.add(a.get("slug"))
except Exception as e:
    print(f"Error fetching categories: {e}")
    sys.exit(1)

results = []

for cat, slug in articles_to_check:
    res = requests.get(f"http://localhost:8000/api/grammar/article/{cat}/{slug}")
    if res.status_code != 200:
        results.append({"article": f"{cat}/{slug}", "status": "Fail", "issues": [f"API returned {res.status_code} (Might have been moved from {cat})"]})
        
        # Try to find it in other categories just in case it was moved (like 'articles' out of advanced)
        for c in cats:
            for a in c.get("articles", []):
                if a.get("slug") == slug:
                    res2 = requests.get(f"http://localhost:8000/api/grammar/article/{c.get('slug')}/{slug}")
                    if res2.status_code == 200:
                        results[-1]["issues"].append(f"Found at {c.get('slug')}/{slug} instead")
        continue
    
    data = res.json()
    html = data.get("html", "")
    
    issues = []
    
    # 1. Check unparsed markdown
    if "***" in html or "## " in html or "[](" in html:
        issues.append("Possible unparsed markdown found in HTML")
        
    # 2. Check in-body links
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a"):
        href = a.get("href", "")
        
        if ".md" in href:
            issues.append(f"Legacy .md link found: {href}")
            
        if "grammar-article=" in href:
            issues.append(f"Legacy query link found: {href}")

    # 3. Check graph edges
    for field in ["next_articles", "related_pages", "compare_with"]:
        refs = data.get(field, [])
        if not isinstance(refs, list):
            # Sometimes it might be a single string or dict if schema varies
            if isinstance(refs, str):
                refs = [refs]
            else:
                continue
        for ref in refs:
            slug_ref = ref.get("slug") if isinstance(ref, dict) else ref
            if slug_ref not in all_slugs:
                issues.append(f"Broken {field} reference: {slug_ref} (Not found in global slug list)")
                
    if slug == "articles" and data.get("category") == "advanced":
        issues.append("Article is still in 'advanced' category")
        
    # Check specific metadata for missing-subjects and missing-main-verbs
    tags = data.get("common_error_tags", [])
    if slug == "missing-subjects":
        if "omitted-subject" not in tags and "omitted_subject" not in tags:
            issues.append(f"Missing 'omitted-subject' tag. Current tags: {tags}")
        if "subject_verb_disagreement" in tags:
            issues.append("Still has 'subject_verb_disagreement' tag")
            
    if slug == "missing-main-verbs":
        if "missing-main-verb" not in tags and "missing_main_verb" not in tags:
            issues.append(f"Missing 'missing-main-verb' tag. Current tags: {tags}")
        if "subject_verb_disagreement" in tags:
            issues.append("Still has 'subject_verb_disagreement' tag")
            
    results.append({
        "article": slug,
        "status": "Pass" if not issues else "Fail",
        "issues": issues
    })

print("# Batch A Verification Results\n")
for r in results:
    print(f"**Article**: `{r['article']}`")
    print(f"**Status**: {'✅ Pass' if r['status'] == 'Pass' else '❌ Fail'}")
    if r['issues']:
        print("**Issues**:")
        for i in r['issues']:
            print(f"  - {i}")
    else:
        print("**Issues**: None")
    print()
