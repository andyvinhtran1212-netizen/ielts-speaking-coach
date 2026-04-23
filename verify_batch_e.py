import requests
import yaml
import os

articles_to_check = [
    ("ielts-grammar-lab", "grammar-in-task2"),
    ("ielts-grammar-lab", "grammar-in-task1"),
    ("ielts-grammar-lab", "making-answers-longer-naturally"),
    ("grammar-for-meaning", "hedging-language"),
    ("sentence-structures", "adding-results-clearly"),
    ("grammar-for-meaning", "discourse-markers")
]

results = []

for cat, slug in articles_to_check:
    # 1. Read the local file to get fresh next_articles
    filepath = f"backend/content/{cat}/{slug}.md"
    if not os.path.exists(filepath):
        results.append({"article": slug, "status": "Fail", "issues": [f"File {filepath} not found"]})
        continue
        
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # extract yaml frontmatter
    if content.startswith("---"):
        end_idx = content.find("---", 3)
        yaml_str = content[3:end_idx].strip()
        frontmatter = yaml.safe_load(yaml_str)
    else:
        frontmatter = {}
        
    next_articles = frontmatter.get("next_articles", [])
    if isinstance(next_articles, str):
        next_articles = [next_articles]
        
    issues = []
    if slug != "discourse-markers" and "discourse-markers" in next_articles:
        issues.append("discourse-markers found in next_articles")
        
    # 2. Check rendering via API (even if cached, we check if it compiles without raw markdown)
    res = requests.get(f"http://localhost:8000/api/grammar/article/{cat}/{slug}")
    if res.status_code != 200:
        issues.append(f"API returned {res.status_code}")
    else:
        html = res.json().get("html", "")
        if "|---|" in html or "| --- |" in html or "***" in html or "## " in html or "[](" in html:
            issues.append("Possible unparsed markdown found in HTML")
            
    results.append({
        "article": slug,
        "status": "Pass" if not issues else "Fail",
        "next_articles": next_articles,
        "issues": issues
    })

print("Batch E Verification Results:")
for r in results:
    print(f"Article: {r['article']}")
    print(f"  Status: {r['status']}")
    print(f"  Next Articles: {r['next_articles']}")
    print(f"  Issues: {r['issues']}")
