"""
Fallback image downloader - uses image URLs already in the CSV
(Main Image, Google Image columns) for suppliers that didn't get images from Serper.
"""
import os
import re
import json
import time
import requests
import pandas as pd

INPUT_FILE = "engaged_suppliers_final_production.csv"
OUTPUT_JSON = "../data/supplier_images.json"
MEDIA_DIR = "../public/media/suppliers"

def clean_filename(name):
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', name)

def download_image(url, save_path):
    if not url or not str(url).startswith('http'):
        return False
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        res = requests.get(str(url), headers=headers, timeout=15)
        if res.status_code == 200 and 'image' in res.headers.get('Content-Type', ''):
            with open(save_path, 'wb') as f:
                f.write(res.content)
            return True
    except Exception:
        pass
    return False

def scrape_first_image_from_website(url):
    """Try to grab the first image from a supplier's website."""
    if not url or not str(url).startswith('http'):
        return None
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        res = requests.get(str(url), headers=headers, timeout=10)
        if res.status_code != 200:
            return None
        # Find og:image (most reliable)
        og_match = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', res.text)
        if og_match:
            return og_match.group(1)
        # Find first large img src
        img_matches = re.findall(r'<img[^>]+src=["\']([^"\']+\.(jpg|jpeg|png|webp))["\']', res.text, re.IGNORECASE)
        for img_url, _ in img_matches:
            if img_url.startswith('http') and len(img_url) > 20:
                return img_url
    except Exception:
        pass
    return None

def main():
    print("\n" + "="*60)
    print("--- [FALLBACK IMAGE DOWNLOADER - CSV + WEBSITE] ---")
    print("="*60 + "\n")

    os.makedirs(MEDIA_DIR, exist_ok=True)

    # Load existing data
    existing_data = {}
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            print(f"[*] Loaded: {len(existing_data)} entries in supplier_images.json")
        except Exception as e:
            print(f"[!] Error loading JSON: {e}")

    df = pd.read_csv(INPUT_FILE)
    total = len(df)

    # Find suppliers with no images
    missing = []
    for i, row in df.iterrows():
        name = row["Supplier Name"]
        entry = existing_data.get(name, {})
        if not entry.get("downloaded_images"):
            missing.append((i, row))

    print(f"[*] Suppliers without images: {len(missing)}/{total}\n")

    updated = 0
    for idx, (i, row) in enumerate(missing):
        supplier_name = row["Supplier Name"]
        phone = str(row["Real Phone"]) if not pd.isna(row.get("Real Phone")) else f"index_{i}"
        folder_name = clean_filename(phone)
        supplier_folder = os.path.join(MEDIA_DIR, folder_name)
        os.makedirs(supplier_folder, exist_ok=True)

        print(f"[{idx+1}/{len(missing)}] {supplier_name[:55]}...", end=" ", flush=True)

        downloaded = []
        img_idx = 1

        # Source 1: Google Image from CSV
        google_img = str(row.get("Google Image", "")) if not pd.isna(row.get("Google Image", float('nan'))) else ""
        if google_img.startswith("http") and img_idx <= 5:
            save_path = os.path.join(supplier_folder, f"img_{img_idx}.jpg")
            if download_image(google_img, save_path):
                downloaded.append(f"/media/suppliers/{folder_name}/img_{img_idx}.jpg")
                img_idx += 1

        # Source 2: Main Image from CSV
        main_img = str(row.get("Main Image", "")) if not pd.isna(row.get("Main Image", float('nan'))) else ""
        if main_img.startswith("http") and img_idx <= 5:
            save_path = os.path.join(supplier_folder, f"img_{img_idx}.jpg")
            if download_image(main_img, save_path):
                downloaded.append(f"/media/suppliers/{folder_name}/img_{img_idx}.jpg")
                img_idx += 1

        # Source 3: Gallery images from CSV (pipe or comma separated URLs)
        gallery_raw = str(row.get("Gallery", "")) if not pd.isna(row.get("Gallery", float('nan'))) else ""
        if gallery_raw and gallery_raw not in ("nan", "N/A", ""):
            # Split by common separators
            gallery_urls = re.split(r'[|,\n]', gallery_raw)
            for g_url in gallery_urls:
                g_url = g_url.strip()
                if g_url.startswith("http") and img_idx <= 5:
                    save_path = os.path.join(supplier_folder, f"img_{img_idx}.jpg")
                    if download_image(g_url, save_path):
                        downloaded.append(f"/media/suppliers/{folder_name}/img_{img_idx}.jpg")
                        img_idx += 1

        # Source 4: Scrape og:image from Website
        website = str(row.get("Website", "")) if not pd.isna(row.get("Website", float('nan'))) else ""
        if img_idx <= 5 and website and website.startswith("http"):
            scraped_url = scrape_first_image_from_website(website)
            if scraped_url:
                save_path = os.path.join(supplier_folder, f"img_{img_idx}.jpg")
                if download_image(scraped_url, save_path):
                    downloaded.append(f"/media/suppliers/{folder_name}/img_{img_idx}.jpg")
                    img_idx += 1

        # Source 5: Scrape og:image from supplier page URL
        page_url = str(row.get("URL", "")) if not pd.isna(row.get("URL", float('nan'))) else ""
        if img_idx <= 5 and page_url and page_url.startswith("http"):
            scraped_url = scrape_first_image_from_website(page_url)
            if scraped_url:
                save_path = os.path.join(supplier_folder, f"img_{img_idx}.jpg")
                if download_image(scraped_url, save_path):
                    downloaded.append(f"/media/suppliers/{folder_name}/img_{img_idx}.jpg")

        status = f"✓ {len(downloaded)} imgs" if downloaded else "✗ none"
        print(status)

        existing_data[supplier_name] = {
            "downloaded_images": downloaded,
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source": "csv_fallback"
        }

        if downloaded:
            updated += 1

        # Save every supplier
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(existing_data, f, ensure_ascii=False, indent=2)

        time.sleep(0.3)

    total_with_images = sum(1 for v in existing_data.values() if v.get("downloaded_images"))
    print(f"\n{'='*60}")
    print(f"✅ סיום! עדכנו {updated} ספקים חדשים.")
    print(f"📊 סה\"כ עם תמונות: {total_with_images}/{total}")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
