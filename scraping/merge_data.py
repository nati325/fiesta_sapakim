"""
Merge Data - Combines all scraped JSONs and the base CSV into one unified file.
Creates: data/suppliers_complete.json
"""
import os
import json
import pandas as pd

CSV_FILE = "engaged_suppliers_final_production.csv"
IMAGES_JSON = "../data/supplier_images.json"
REVIEWS_JSON = "../data/supplier_reviews.json"
DESC_JSON = "../data/supplier_descriptions.json"
PORTFOLIOS_JSON = "../data/supplier_portfolios.json"
OUTPUT_JSON = "../data/suppliers_complete.json"

def load_json(filepath):
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[!] Error loading {filepath}: {e}")
    return {}

def main():
    print("\n" + "="*60)
    print("--- [MERGING ALL DATA INTO ONE JSON] ---")
    print("="*60 + "\n")

    # Load all sources
    print("[*] Loading CSV base data...")
    df = pd.read_csv(CSV_FILE)
    
    print("[*] Loading scraped JSON files...")
    images_data = load_json(IMAGES_JSON)
    reviews_data = load_json(REVIEWS_JSON)
    desc_data = load_json(DESC_JSON)
    portfolios_data = load_json(PORTFOLIOS_JSON)

    suppliers_complete = []

    for i, row in df.iterrows():
        name = str(row["Supplier Name"])
        
        # Base CSV Data
        supplier = {
            "id": i + 1,
            "name": name,
            "clean_name": name.split('|')[0].strip(),
            "phone": str(row.get("Phone Number", "")),
            "real_phone": str(row.get("Real Phone", "")),
            "category": str(row.get("Category", "")),
            "website": str(row.get("Website", "")),
            "address": str(row.get("Address", "")),
            "engaged_url": str(row.get("URL", "")),
        }

        # Handle NaNs and convert to None
        for k, v in supplier.items():
            if pd.isna(v) or v == "nan":
                supplier[k] = None

        # 1. Add Images
        img_info = images_data.get(name, {})
        supplier["images"] = img_info.get("downloaded_images", [])

        # 2. Add Reviews & Rating
        rev_info = reviews_data.get(name, {})
        supplier["reviews"] = rev_info.get("reviews", [])
        
        # Get rating from CSV first, fallback to reviews JSON
        csv_rating = str(row.get("Google Rating", ""))
        supplier["google_rating"] = csv_rating if csv_rating and csv_rating != "nan" else rev_info.get("google_rating")
        
        csv_reviews_count = str(row.get("Reviews Count", ""))
        supplier["reviews_count"] = csv_reviews_count if csv_reviews_count and csv_reviews_count != "nan" else rev_info.get("reviews_count")

        # 3. Add Description
        desc_info = desc_data.get(name, {})
        supplier["description"] = desc_info.get("description", None)

        # 4. Add Portfolio
        port_info = portfolios_data.get(name, {})
        supplier["portfolio"] = port_info.get("portfolio_images", [])

        suppliers_complete.append(supplier)

    print(f"\n[*] Total suppliers merged: {len(suppliers_complete)}")
    
    # Stats
    with_imgs = sum(1 for s in suppliers_complete if s["images"])
    with_revs = sum(1 for s in suppliers_complete if s["reviews"])
    with_desc = sum(1 for s in suppliers_complete if s["description"])
    with_port = sum(1 for s in suppliers_complete if s["portfolio"])
    
    print(f"  - With basic images: {with_imgs}")
    print(f"  - With reviews: {with_revs}")
    print(f"  - With descriptions: {with_desc}")
    print(f"  - With portfolios: {with_port}")

    # Write output
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(suppliers_complete, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Saved successfully to: {OUTPUT_JSON}")

if __name__ == "__main__":
    main()
