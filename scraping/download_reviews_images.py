import os
import re
import json
import time
import requests
import pandas as pd
from google import genai
from google.genai import types

# --- Configuration ---
API_KEYS = [
    "AIzaSyDLga3BzXoRCc3XyoyBmxmT2egg--IAyzM"
]
INPUT_FILE = "engaged_suppliers_final_production.csv"
OUTPUT_JSON = "../data/reviews_and_images.json"
MEDIA_DIR = "../public/media/suppliers"

current_key_index = 0
current_model_index = 0

# Limit to 1.5 models which are widely accessible and support v1beta Google Search grounding
MODELS_TO_TRY = [
    "gemini-1.5-flash",
    "gemini-1.5-pro",
]

def get_next_client():
    global current_key_index
    key = API_KEYS[current_key_index % len(API_KEYS)]
    current_key_index += 1
    # Force api_version to 'v1beta' which is required for Google Search grounding tool
    return genai.Client(api_key=key, http_options={'api_version': 'v1beta'})

def clean_filename(name):
    # Keep only english, numbers, and basic symbols to avoid Windows file system errors
    return re.sub(r'[^a-zA-Z0-9_\-]', '_', name)

def download_image(url, save_path):
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code == 200:
            content_type = res.headers.get('Content-Type', '')
            if 'image' in content_type:
                with open(save_path, 'wb') as f:
                    f.write(res.content)
                return True
    except Exception as e:
        pass
    return False

def get_reviews_and_image_urls(supplier_name, category, address):
    global current_model_index
    
    clean_name = supplier_name.split('|')[0].strip()
    
    prompt = f"""
    Research the Israeli wedding supplier: "{clean_name}" (category: {category}, address: {address}).
    Use Google Search to find their Google Reviews (specifically high rating/good ones) and images of their business.
    
    We need:
    1. Up to 5 Google review comments in Hebrew that are positive (4 or 5 stars). For each review, extract:
       - reviewer: Name of the reviewer
       - rating: Rating (4 or 5)
       - text: The review text in Hebrew
    2. Up to 5 direct image URLs representing this supplier (photos of venue, work, design, logo, etc.).
       Avoid base64, tracking pixels, or search query urls. They must be direct image source links.
       
    Return ONLY JSON in this format:
    {{
      "reviews": [
        {{"reviewer": "...", "rating": 5, "text": "..."}}
      ],
      "image_urls": [
        "https://...",
        "https://..."
      ]
    }}
    """
    
    max_attempts = 6
    base_delay = 5
    
    for attempt in range(max_attempts):
        model_to_use = MODELS_TO_TRY[current_model_index % len(MODELS_TO_TRY)]
        current_model_index += 1
        
        try:
            client = get_next_client()
            print(f"    [*] Attempt {attempt+1}: Calling {model_to_use}...", end=" ", flush=True)
            
            response = client.models.generate_content(
                model=model_to_use,
                contents=prompt,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                    temperature=0.1
                )
            )
            
            print("Done.")
            text = response.text
            
            # Clean JSON markdown wrapper if exists
            json_match = re.search(r'(\{.*\})', text, re.DOTALL)
            if json_match:
                text = json_match.group(1)
                brace_count = 0
                for i, char in enumerate(text):
                    if char == '{': brace_count += 1
                    elif char == '}': brace_count -= 1
                    if brace_count == 0:
                        text = text[:i+1]
                        break
            
            return json.loads(text)
        except Exception as e:
            err_msg = str(e)
            is_503 = "503" in err_msg or "UNAVAILABLE" in err_msg or "429" in err_msg
            status_label = "BUSY (503/429)" if is_503 else f"ERROR: {err_msg[:60]}..."
            print(f"Failed ({status_label})")
            
            if attempt < max_attempts - 1:
                sleep_time = (base_delay * (2 ** (attempt % 3))) + 2
                if is_503:
                    sleep_time += 15
                print(f"        [!] Retrying in {sleep_time:.1f}s...")
                time.sleep(sleep_time)
                continue
                
    return {"reviews": [], "image_urls": []}

def main():
    print("\n" + "="*60)
    print("--- [GOOGLE REVIEWS & IMAGES DOWNLOADER V1.2] ---")
    print("="*60 + "\n")
    
    # Ensure directories exist
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    os.makedirs(MEDIA_DIR, exist_ok=True)
    
    # Load existing database
    existing_data = {}
    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
            # Remove failed runs to retry them
            existing_data = {k: v for k, v in existing_data.items() if len(v.get("downloaded_images", [])) > 0 or len(v.get("reviews", [])) > 0}
            print(f"[*] Loaded existing reviews data for {len(existing_data)} successfully processed suppliers.")
        except Exception as e:
            print(f"[!] Error loading existing data: {e}")
            
    df = pd.read_csv(INPUT_FILE)
    print(f"[*] Total suppliers in production: {len(df)}")
    
    for i, row in df.iterrows():
        supplier_name = row["Supplier Name"]
        phone = str(row["Real Phone"]) if not pd.isna(row["Real Phone"]) else f"index_{i}"
        
        key = supplier_name
        
        # Check if already processed
        if key in existing_data:
            print(f"[-] ({i+1}/{len(df)}) Already processed: {supplier_name}. Skipping.")
            continue
            
        print(f"\n[*] ({i+1}/{len(df)}) Researching: {supplier_name}...")
        
        data = get_reviews_and_image_urls(supplier_name, row.get("Category", ""), row.get("Address", ""))
        
        reviews = data.get("reviews", [])
        image_urls = data.get("image_urls", [])
        
        # Download images
        downloaded_local_paths = []
        if image_urls:
            folder_name = clean_filename(phone)
            supplier_folder = os.path.join(MEDIA_DIR, folder_name)
            os.makedirs(supplier_folder, exist_ok=True)
            
            img_idx = 1
            for url in image_urls:
                if img_idx > 5:
                    break
                print(f"    [~] Downloading image {img_idx}: {url[:60]}...", end=" ", flush=True)
                save_path = os.path.join(supplier_folder, f"img_{img_idx}.jpg")
                success = download_image(url, save_path)
                if success:
                    relative_path = f"/media/suppliers/{folder_name}/img_{img_idx}.jpg"
                    downloaded_local_paths.append(relative_path)
                    print("Success.")
                    img_idx += 1
                else:
                    print("Failed.")
                    
        if reviews or downloaded_local_paths:
            existing_data[key] = {
                "reviews": reviews,
                "downloaded_images": downloaded_local_paths,
                "google_rating": row.get("Google Rating", "N/A"),
                "reviews_count": row.get("Reviews Count", "N/A"),
                "last_updated": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
                json.dump(existing_data, f, ensure_ascii=False, indent=2)
            print(f"    [+] Saved: {len(reviews)} reviews and {len(downloaded_local_paths)} images.")
        else:
            print("    [!] No reviews or images found for this supplier.")
            
        time.sleep(2)

if __name__ == "__main__":
    main()
