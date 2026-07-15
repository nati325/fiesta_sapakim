import os
import re
import json
import time
import requests
import pandas as pd

# --- Configuration ---
SERPER_API_KEY = "ae9018b64b8a4a24a1639012bc57ec00d5330e78"
INPUT_FILE = "engaged_suppliers_final_production.csv"
OUTPUT_JSON = "../data/supplier_images.json"
MEDIA_DIR = "../public/media/suppliers"

def clean_filename(name):
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', name)

def is_bad_image_url(url):
    if not url:
        return True
    value = str(url)
    if value.endswith('.svg'):
        return True
    patterns = [
        r'app.?store', r'play\.google', r'play-badge', r'google.?play', r'badge',
        r'mzstatic\.com', r'applemediaservices', r'linkmaker', r'itunes\.apple',
        r'apps\.apple\.com', r'favicon', r'sprite', r'pixel', r'logo_new',
        r'[-_/]logo[-_./]', r'[-_/]icon[-_./]', r'logo-facebook',
    ]
    return any(re.search(p, value, re.I) for p in patterns)

def download_image(url, save_path):
    try:
        if is_bad_image_url(url):
            return False
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code == 200 and 'image' in res.headers.get('Content-Type', ''):
            # Skip App Store badges / tiny icons (~2–6KB)
            if len(res.content) < 12000:
                return False
            with open(save_path, 'wb') as f:
                f.write(res.content)
            return True
    except Exception:
        pass
    return False

def serper_images(query):
    url = "https://google.serper.dev/images"
    payload = json.dumps({"q": query, "gl": "il", "num": 10})
    headers = {'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json'}
    try:
        res = requests.post(url, headers=headers, data=payload, timeout=15)
        if res.status_code == 200:
            return res.json()
        else:
            print(f" [!] Serper HTTP {res.status_code}")
    except Exception as e:
        print(f" [!] Serper error: {e}")
    return None

def main():
    print("\n" + "="*60)
    print("--- [IMAGE DOWNLOADER - IMAGES ONLY MODE] ---")
    print("="*60 + "\n")

    os.makedirs(MEDIA_DIR, exist_ok=True)

    # Load existing data
    existing_data = {}
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            # Only skip if we actually downloaded images
            existing_data = {k: v for k, v in existing_data.items()
                             if len(v.get("downloaded_images", [])) > 0}
            print(f"[*] Resuming: {len(existing_data)} already done.")
        except Exception as e:
            print(f"[!] Error loading existing data: {e}")

    df = pd.read_csv(INPUT_FILE)
    total = len(df)
    print(f"[*] Total suppliers: {total}\n")

    for i, row in df.iterrows():
        supplier_name = row["Supplier Name"]
        phone = str(row["Real Phone"]) if not pd.isna(row.get("Real Phone")) else f"index_{i}"

        if supplier_name in existing_data:
            print(f"[-] ({i+1}/{total}) Already done: {supplier_name[:50]}")
            continue

        clean_name = supplier_name.split('|')[0].strip()
        category = row.get("Category", "")
        image_query = f"{clean_name} {category}"

        print(f"[*] ({i+1}/{total}) {supplier_name[:55]}...", end=" ", flush=True)

        image_data = serper_images(image_query)

        image_urls = []
        if image_data:
            for img in image_data.get("images", []):
                url = img.get("imageUrl", "")
                if url and url.startswith("http") and not is_bad_image_url(url):
                    image_urls.append(url)
                if len(image_urls) >= 5:
                    break

        downloaded_local_paths = []
        if image_urls:
            folder_name = clean_filename(phone)
            supplier_folder = os.path.join(MEDIA_DIR, folder_name)
            os.makedirs(supplier_folder, exist_ok=True)

            img_idx = 1
            for url in image_urls[:5]:
                save_path = os.path.join(supplier_folder, f"img_{img_idx}.jpg")
                if download_image(url, save_path):
                    downloaded_local_paths.append(f"/media/suppliers/{folder_name}/img_{img_idx}.jpg")
                    img_idx += 1

        status = f"✓ {len(downloaded_local_paths)} images" if downloaded_local_paths else "✗ no images"
        print(status)

        # Save regardless (so we don't retry failed suppliers in this session)
        existing_data[supplier_name] = {
            "downloaded_images": downloaded_local_paths,
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S")
        }

        # Save immediately after every supplier
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(existing_data, f, ensure_ascii=False, indent=2)

        time.sleep(0.5)  # Light delay - no AI calls needed

    # Final save
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)

    done = sum(1 for v in existing_data.values() if v.get("downloaded_images"))
    print(f"\n{'='*60}")
    print(f"✅ סיום! הורדנו תמונות ל-{done}/{total} ספקים.")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
