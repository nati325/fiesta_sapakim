"""
Reviews Downloader - fetches customer reviews from Google via Serper API.
Runs independently, can run in parallel with fallback_images.py.
"""
import os
import re
import json
import time
import requests
import pandas as pd

SERPER_API_KEY = "ae9018b64b8a4a24a1639012bc57ec00d5330e78"
INPUT_FILE = "engaged_suppliers_final_production.csv"
OUTPUT_JSON = "../data/supplier_reviews.json"

REVIEW_INDICATOR_WORDS = [
    'מעולה', 'מדהים', 'נהדר', 'ממליץ', 'ממליצה', 'שירות', 'מצוין', 'מושלם',
    'יפה', 'כיף', 'חוויה', 'אירוע', 'חתונה', 'מרוצה', 'תודה', 'מקצועי',
    'excellent', 'amazing', 'great', 'recommend', 'perfect', 'wonderful'
]

def serper_search(query):
    url = "https://google.serper.dev/search"
    payload = json.dumps({"q": query, "gl": "il", "hl": "iw", "num": 10})
    headers = {'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json'}
    try:
        res = requests.post(url, headers=headers, data=payload, timeout=15)
        if res.status_code == 200:
            return res.json()
        print(f" [!] Serper HTTP {res.status_code}")
    except Exception as e:
        print(f" [!] Serper error: {str(e)[:60]}")
    return None

def extract_reviews_from_serper(search_data, supplier_name):
    """Extract review-like snippets directly from Serper results."""
    reviews = []
    if not search_data:
        return reviews

    review_sources = [
        'google.com/maps', 'maps.google', 'engaged.co.il', 'weddingwire',
        'zap.co.il', 'bizrate', 'yelp', 'reviews', 'ביקורות'
    ]

    for result in search_data.get("organic", [])[:10]:
        snippet = result.get('snippet', '').strip()
        title = result.get('title', '').strip()
        link = result.get('link', '').lower()

        if not snippet or len(snippet) < 25:
            continue

        has_hebrew = any('\u05d0' <= c <= '\u05ea' for c in snippet)
        is_review_source = any(s in link for s in review_sources)
        has_review_words = any(w in snippet for w in REVIEW_INDICATOR_WORDS)

        if has_hebrew and (is_review_source or has_review_words):
            # Try to extract reviewer name
            reviewer = "לקוח מרוצה"
            name_match = re.search(r'^([\u05d0-\u05ea]{2,8}\s[\u05d0-\u05ea]{2,10})', title)
            if name_match:
                reviewer = name_match.group(1)

            clean_text = re.sub(r'\d{1,2}[./]\d{1,2}[./]\d{2,4}', '', snippet).strip()
            clean_text = re.sub(r'\s+', ' ', clean_text)

            if len(clean_text) > 20:
                reviews.append({
                    "reviewer": reviewer,
                    "rating": 5,
                    "text": clean_text[:400],
                    "source": link
                })

        if len(reviews) >= 5:
            break

    # Also check the "reviews" block in Serper if available
    for review in search_data.get("reviews", [])[:5]:
        text = review.get('snippet', '') or review.get('text', '')
        if text and len(text) > 20:
            reviews.append({
                "reviewer": review.get('author', 'לקוח מרוצה'),
                "rating": review.get('rating', 5),
                "text": text[:400],
                "source": "google"
            })
        if len(reviews) >= 5:
            break

    return reviews[:5]

def main():
    print("\n" + "="*60)
    print("--- [REVIEWS DOWNLOADER V1.0 - Serper Only] ---")
    print("="*60 + "\n")

    # Load existing data
    existing_data = {}
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            # Only skip if we have actual reviews
            done = {k for k, v in existing_data.items() if v.get("reviews")}
            print(f"[*] Already have reviews for: {len(done)} suppliers. Resuming...")
        except Exception as e:
            print(f"[!] Error loading existing data: {e}")
            done = set()
    else:
        done = set()

    df = pd.read_csv(INPUT_FILE)
    total = len(df)
    print(f"[*] Total suppliers: {total}")
    remaining = total - len(done)
    print(f"[*] Remaining to process: {remaining}\n")

    found_count = 0

    for i, row in df.iterrows():
        supplier_name = row["Supplier Name"]

        if supplier_name in done:
            print(f"[-] ({i+1}/{total}) Skip: {supplier_name[:45]}")
            continue

        clean_name = supplier_name.split('|')[0].strip()
        category = str(row.get("Category", ""))
        rating = str(row.get("Google Rating", ""))

        # Search query - specifically for reviews
        query = f'{clean_name} {category} ביקורות לקוחות'

        print(f"[{i+1}/{total}] {supplier_name[:50]}...", end=" ", flush=True)

        search_data = serper_search(query)
        reviews = extract_reviews_from_serper(search_data, clean_name)

        status = f"✓ {len(reviews)} reviews" if reviews else "✗ none"
        print(status)

        existing_data[supplier_name] = {
            "reviews": reviews,
            "google_rating": rating,
            "reviews_count": str(row.get("Reviews Count", "")),
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S")
        }

        if reviews:
            found_count += 1

        # Save after every supplier
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(existing_data, f, ensure_ascii=False, indent=2)

        time.sleep(0.8)  # Respect rate limits

    total_with_reviews = sum(1 for v in existing_data.values() if v.get("reviews"))
    print(f"\n{'='*60}")
    print(f"✅ סיום! מצאנו ביקורות ל-{total_with_reviews}/{total} ספקים.")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
