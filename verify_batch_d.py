import requests

articles_to_check = [
    ("parts-of-speech", "nouns"),
    ("parts-of-speech", "verbs"),
    ("parts-of-speech", "pronouns")
]

cats = requests.get("http://localhost:8000/api/grammar/categories").json()
all_slugs = set()
for c in cats:
    for a in c.get("articles", []):
        all_slugs.add(a.get("slug"))

results = []

for cat, slug in articles_to_check:
    res = requests.get(f"http://localhost:8000/api/grammar/article/{cat}/{slug}")
    if res.status_code != 200:
        results.append({"article": slug, "status": "Fail", "issues": [f"API returned {res.status_code}"]})
        continue
    
    data = res.json()
    html = data.get("html", "")
    
    issues = []
    
    # Check unparsed markdown
    # Tables often have |---| if not parsed
    if "|---|" in html or "| --- |" in html or "***" in html or "## " in html or "[](" in html:
        issues.append("Possible unparsed markdown found in HTML")
        
    # Check graph edges
    for field in ["next_articles", "related_pages", "compare_with"]:
        refs = data.get(field, [])
        if isinstance(refs, str): refs = [refs]
        if not isinstance(refs, list): continue
        for ref in refs:
            slug_ref = ref.get("slug") if isinstance(ref, dict) else ref
            if slug_ref not in all_slugs:
                issues.append(f"Broken {field} reference: {slug_ref}")
                
    results.append({
        "article": slug,
        "status": "Pass" if not issues else "Fail",
        "issues": issues
    })

print("Batch D Verification Results:")
for r in results:
    print(f"Article: {r['article']} | Status: {r['status']} | Issues: {r['issues']}")
