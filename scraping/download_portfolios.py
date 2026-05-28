"""
Portfolio Scraper - downloads gallery/portfolio images for visual suppliers.
Targets categories that benefit from portfolios: photographers, makeup, florists, etc.
Scrapes from: 1) Gallery column in CSV, 2) Supplier website gallery section, 3) Serper Images
"""
import os
import re
import json
import time
import requests
import pandas as pd

SERPER_API_KEY = "ae9018b64b8a4a24a1639012bc57ec00d5330e78"
INPUT_FILE = "engaged_suppliers_final_production.csv"
OUTPUT_JSON = "../data/supplier_portfolios.json"
MEDIA_DIR = "../public/media/portfolios"

# Categories that typically have portfolios
PORTFOLIO_CATEGORIES = [
    "צלמים", "צילום", "צלם",
    "מאפרות", "מאפרת", "איפור",
    "שיער", "עיצוב שיער",
    "עיצוב פרחים", "פרחים", "שזירה",
    "עיצוב אירועים", "עיצוב", "דקורציה",
    "עוגות", "קינוחים", "ממתקים",
    "הזמנות", "הדפסות",
    "שמלות", "אופנה",
    "קייטרינג", "קיטרינג",
    "תכשיטים",
    "וידאו", "קליפ",
]

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

def is_portfolio_category(category):
    category_lower = str(category).lower()
    return any(cat.lower() in category_lower for cat in PORTFOLIO_CATEGORIES)

def download_image(url, save_path):
    if not url or not str(url).startswith('http'):
        return False
    try:
        res = requests.get(str(url), headers=HEADERS, timeout=15)
        if res.status_code == 200 and 'image' in res.headers.get('Content-Type', ''):
            # Skip very small images (icons/thumbnails < 5KB)
            if len(res.content) < 5000:
                return False
            with open(save_path, 'wb') as f:
                f.write(res.content)
            return True
    except Exception:
        pass
    return False

# URL patterns that indicate a portfolio/gallery page
PORTFOLIO_URL_KEYWORDS = [
    'gallery', 'portfolio', 'works', 'photos', 'album',
    'גלריה', 'תיק', 'עבודות', 'תמונות', 'פרויקטים'
]

def find_portfolio_page_url(base_url):
    """Find the gallery/portfolio page link from a supplier's homepage."""
    if not base_url or not base_url.startswith('http'):
        return None
    try:
        res = requests.get(base_url, headers=HEADERS, timeout=10)
        if res.status_code != 200:
            return None
        html = res.text
        # Extract base domain
        base_domain = re.match(r'(https?://[^/]+)', base_url).group(1)

        # Find all <a href> links
        all_links = re.findall(r'href=["\']([^"\']+)["\']', html)
        for link in all_links:
            link_lower = link.lower()
            if any(kw in link_lower for kw in PORTFOLIO_URL_KEYWORDS):
                # Make absolute
                if link.startswith('http'):
                    return link
                elif link.startswith('//'):
                    return 'https:' + link
                elif link.startswith('/'):
                    return base_domain + link
                else:
                    return base_url.rstrip('/') + '/' + link
        return None
    except Exception:
        return None

def scrape_gallery_from_website(url, max_images=10):
    """Scrape gallery images from a URL (can be portfolio page or homepage)."""
    if not url or not str(url).startswith('http'):
        return []
    try:
        res = requests.get(str(url), headers=HEADERS, timeout=12)
        if res.status_code != 200:
            return []
        html = res.text

        found_urls = set()

        # Look for gallery/portfolio section images
        gallery_patterns = [
            # WordPress gallery shortcodes and classes
            r'class=["\'][^"\']*(?:gallery|portfolio|work|album|lightbox)[^"\']*["\'][^>]*>.*?<img[^>]+src=["\']([^"\']+\.(jpg|jpeg|png|webp))["\']',
            # Standard img tags with large images
            r'<img[^>]+(?:data-src|src)=["\']([^"\']{20,}\.(jpg|jpeg|png|webp)(?:\?[^"\']*)?)["\']',
        ]

        for pattern in gallery_patterns:
            for match in re.finditer(pattern, html, re.IGNORECASE | re.DOTALL):
                img_url = match.group(1) if isinstance(match.group(1), str) else match.group(0)
                # Make relative URLs absolute
                if img_url.startswith('//'):
                    img_url = 'https:' + img_url
                elif img_url.startswith('/'):
                    base = re.match(r'(https?://[^/]+)', url)
                    if base:
                        img_url = base.group(1) + img_url
                if img_url.startswith('http') and not any(skip in img_url.lower() for skip in ['logo', 'icon', 'favicon', 'banner', 'thumb', 'avatar', 'pixel']):
                    found_urls.add(img_url)
                if len(found_urls) >= max_images:
                    break
            if len(found_urls) >= max_images:
                break

        return list(found_urls)[:max_images]

    except Exception:
        return []

def serper_images_portfolio(supplier_name, category, num=10):
    """Search for portfolio images via Serper."""
    url = "https://google.serper.dev/images"
    clean_name = supplier_name.split('|')[0].strip()
    query = f'{clean_name} {category} עבודות'
    payload = json.dumps({"q": query, "gl": "il", "num": num})
    headers_api = {'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json'}
    try:
        res = requests.post(url, headers=headers_api, data=payload, timeout=15)
        if res.status_code == 200:
            data = res.json()
            urls = []
            for img in data.get("images", []):
                img_url = img.get("imageUrl", "")
                if img_url and img_url.startswith("http") and not img_url.endswith(".svg"):
                    urls.append(img_url)
                if len(urls) >= num:
                    break
            return urls
    except Exception as e:
        print(f" [!] Serper error: {str(e)[:40]}")
    return []

def clean_filename(name):
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', name)

def main():
    print("\n" + "="*60)
    print("--- [PORTFOLIO SCRAPER V1.0] ---")
    print("="*60 + "\n")

    os.makedirs(MEDIA_DIR, exist_ok=True)

    # Load existing data
    existing_data = {}
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            done = {k for k, v in existing_data.items() if v.get("portfolio_images")}
            print(f"[*] Already done: {len(done)} suppliers. Resuming...")
        except Exception as e:
            print(f"[!] Error: {e}")
            done = set()
    else:
        done = set()

    df = pd.read_csv(INPUT_FILE)
    total = len(df)

    # Filter only portfolio-relevant categories
    portfolio_df = df[df["Category"].apply(is_portfolio_category)]
    print(f"[*] Total suppliers: {total}")
    print(f"[*] Portfolio-relevant: {len(portfolio_df)}")
    print(f"[*] Remaining: {len(portfolio_df) - len(done)}\n")

    found_count = 0

    for i, row in portfolio_df.iterrows():
        supplier_name = row["Supplier Name"]

        if supplier_name in done:
            print(f"[-] ({i+1}/{total}) Skip: {supplier_name[:45]}")
            continue

        print(f"\n[{i+1}/{total}] {supplier_name[:55]}")
        category = str(row.get("Category", ""))
        phone = str(row["Real Phone"]) if not pd.isna(row.get("Real Phone")) else f"index_{i}"
        folder_name = clean_filename(phone)
        supplier_folder = os.path.join(MEDIA_DIR, folder_name)
        os.makedirs(supplier_folder, exist_ok=True)

        all_image_urls = []

        # Source 1: Gallery column from CSV
        gallery_raw = str(row.get("Gallery", "")) if not pd.isna(row.get("Gallery", float('nan'))) else ""
        if gallery_raw and gallery_raw not in ("nan", "N/A", ""):
            gallery_urls = re.split(r'[|,\n]', gallery_raw)
            for g_url in gallery_urls:
                g_url = g_url.strip()
                if g_url.startswith("http"):
                    all_image_urls.append(g_url)
            if all_image_urls:
                print(f"    [CSV Gallery] Found {len(all_image_urls)} URLs")

        # Source 2: Supplier website gallery scrape
        website = str(row.get("Website", "")) if not pd.isna(row.get("Website", float('nan'))) else ""
        if website.startswith("http") and len(all_image_urls) < 10:
            portfolio_url = find_portfolio_page_url(website)
            target_url = portfolio_url if portfolio_url else website
            
            print(f"    [Website] Scraping {target_url[:50]}...", end=" ", flush=True)
            website_imgs = scrape_gallery_from_website(target_url, max_images=10 - len(all_image_urls))
            
            # Fallback to main website if portfolio page didn't yield images
            if not website_imgs and target_url != website:
                website_imgs = scrape_gallery_from_website(website, max_images=10 - len(all_image_urls))
                
            all_image_urls.extend(website_imgs)
            print(f"Found {len(website_imgs)}")

        # Source 3: Serper Images with portfolio query
        if len(all_image_urls) < 5:
            print(f"    [Serper] Searching portfolio images...", end=" ", flush=True)
            serper_imgs = serper_images_portfolio(supplier_name, category, num=10 - len(all_image_urls))
            all_image_urls.extend(serper_imgs)
            print(f"Found {len(serper_imgs)}")

        # Download up to 10 unique images
        downloaded = []
        seen_urls = set()
        img_idx = 1

        for url in all_image_urls:
            if img_idx > 10 or url in seen_urls:
                continue
            seen_urls.add(url)
            save_path = os.path.join(supplier_folder, f"portfolio_{img_idx}.jpg")
            if download_image(url, save_path):
                downloaded.append(f"/media/portfolios/{folder_name}/portfolio_{img_idx}.jpg")
                img_idx += 1

        print(f"    ✓ Downloaded {len(downloaded)} portfolio images")

        existing_data[supplier_name] = {
            "portfolio_images": downloaded,
            "category": category,
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S")
        }

        if downloaded:
            found_count += 1

        # Save after every supplier
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(existing_data, f, ensure_ascii=False, indent=2)

        time.sleep(0.5)

    total_with_portfolio = sum(1 for v in existing_data.values() if v.get("portfolio_images"))
    print(f"\n{'='*60}")
    print(f"✅ סיום! תיקי עבודות ל-{total_with_portfolio}/{len(portfolio_df)} ספקים.")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
