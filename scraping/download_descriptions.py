"""
Description Scraper - fetches business descriptions from supplier websites.
Tries 3 sources per supplier:
  1. Website meta description / og:description
  2. engaged.co.il page description
  3. Serper search snippet (fallback)
"""
import os
import re
import json
import time
import requests
import pandas as pd

SERPER_API_KEY = "ae9018b64b8a4a24a1639012bc57ec00d5330e78"
INPUT_FILE = "engaged_suppliers_final_production.csv"
OUTPUT_JSON = "../data/supplier_descriptions.json"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

def scrape_description_from_url(url):
    """Scrape meta description / og:description from a URL."""
    if not url or not str(url).startswith('http'):
        return None
    try:
        res = requests.get(str(url), headers=HEADERS, timeout=10)
        if res.status_code != 200:
            return None
        html = res.text

        # Priority 1: og:description
        og_match = re.search(
            r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']{20,})["\']',
            html, re.IGNORECASE
        )
        if og_match:
            return clean_description(og_match.group(1))

        # Try reversed attribute order
        og_match2 = re.search(
            r'<meta[^>]+content=["\']([^"\']{20,})["\'][^>]+property=["\']og:description["\']',
            html, re.IGNORECASE
        )
        if og_match2:
            return clean_description(og_match2.group(1))

        # Priority 2: meta description
        meta_match = re.search(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']{20,})["\']',
            html, re.IGNORECASE
        )
        if meta_match:
            return clean_description(meta_match.group(1))

        meta_match2 = re.search(
            r'<meta[^>]+content=["\']([^"\']{20,})["\'][^>]+name=["\']description["\']',
            html, re.IGNORECASE
        )
        if meta_match2:
            return clean_description(meta_match2.group(1))

        # Priority 3: first meaningful <p> tag with Hebrew text
        p_matches = re.findall(r'<p[^>]*>([^<]{40,})</p>', html)
        for p in p_matches:
            p = p.strip()
            has_hebrew = any('\u05d0' <= c <= '\u05ea' for c in p)
            if has_hebrew and len(p) > 40:
                return clean_description(p)

    except Exception:
        pass
    return None

def serper_snippet(supplier_name, category):
    """Get description from Serper search snippet as fallback."""
    url = "https://google.serper.dev/search"
    query = f'{supplier_name.split("|")[0].strip()} {category}'
    payload = json.dumps({"q": query, "gl": "il", "hl": "iw", "num": 5})
    headers = {'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json'}
    try:
        res = requests.post(url, headers=headers, data=payload, timeout=15)
        if res.status_code == 200:
            data = res.json()
            # Look for their official site snippet
            for result in data.get("organic", [])[:5]:
                snippet = result.get('snippet', '').strip()
                has_hebrew = any('\u05d0' <= c <= '\u05ea' for c in snippet)
                if has_hebrew and len(snippet) > 30:
                    return clean_description(snippet)
    except Exception:
        pass
    return None

def clean_description(text):
    """Clean up description text."""
    # Remove HTML entities and tags
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'&[a-z]+;', ' ', text)
    text = re.sub(r'&#\d+;', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    # Limit length
    if len(text) > 500:
        text = text[:500].rsplit(' ', 1)[0] + '...'
    return text if len(text) > 20 else None

def main():
    print("\n" + "="*60)
    print("--- [DESCRIPTION SCRAPER V1.0] ---")
    print("="*60 + "\n")

    # Load existing data
    existing_data = {}
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            done = {k for k, v in existing_data.items() if v.get("description")}
            print(f"[*] Already have descriptions for: {len(done)} suppliers. Resuming...")
        except Exception as e:
            print(f"[!] Error: {e}")
            done = set()
    else:
        done = set()

    df = pd.read_csv(INPUT_FILE)
    total = len(df)
    print(f"[*] Total suppliers: {total}")
    print(f"[*] Remaining: {total - len(done)}\n")

    found_count = 0

    for i, row in df.iterrows():
        supplier_name = row["Supplier Name"]

        if supplier_name in done:
            print(f"[-] ({i+1}/{total}) Skip: {supplier_name[:45]}")
            continue

        print(f"[{i+1}/{total}] {supplier_name[:55]}...", end=" ", flush=True)

        category = str(row.get("Category", ""))
        website = str(row.get("Website", "")) if not pd.isna(row.get("Website", float('nan'))) else ""
        page_url = str(row.get("URL", "")) if not pd.isna(row.get("URL", float('nan'))) else ""

        description = None
        source = ""

        # Source 1: Supplier's own website
        if website and website.startswith("http"):
            description = scrape_description_from_url(website)
            if description:
                source = "website"

        # Source 2: engaged.co.il page
        if not description and page_url and page_url.startswith("http"):
            description = scrape_description_from_url(page_url)
            if description:
                source = "engaged"

        # Source 3: Serper search snippet
        if not description:
            description = serper_snippet(supplier_name, category)
            if description:
                source = "serper"

        status = f"✓ ({source}) {description[:60]}..." if description else "✗ none"
        print(status)

        existing_data[supplier_name] = {
            "description": description,
            "source": source,
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S")
        }

        if description:
            found_count += 1

        # Save after every supplier
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(existing_data, f, ensure_ascii=False, indent=2)

        time.sleep(0.5)

    total_with_desc = sum(1 for v in existing_data.values() if v.get("description"))
    print(f"\n{'='*60}")
    print(f"✅ סיום! מצאנו תיאורים ל-{total_with_desc}/{total} ספקים.")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
