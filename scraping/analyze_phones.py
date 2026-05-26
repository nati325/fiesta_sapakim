import pandas as pd
import re

def analyze():
    file_path = 'engaged_suppliers_enriched.csv'
    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        print(f"Error loading file: {e}")
        return

    total = len(df)
    
    # Clean phone numbers for better analysis (remove dashes, spaces, +972)
    def clean_phone(p):
        if pd.isna(p) or str(p).lower() in ['n/a', 'failed', 'none', '']:
            return None
        p = str(p).replace('-', '').replace(' ', '').replace('(', '').replace(')', '')
        if p.startswith('+972'):
            p = '0' + p[4:]
        return p

    df['cleaned_phone'] = df['Real Phone'].apply(clean_phone)

    # 1. Potential Proxies (072, 073)
    proxies = df[df['cleaned_phone'].str.startswith(('072', '073'), na=False)]
    
    # 2. Duplicates (Same number for multiple suppliers)
    counts = df['cleaned_phone'].value_counts()
    duplicates_list = counts[counts > 1].index.tolist()
    duplicated_rows = df[df['cleaned_phone'].isin(duplicates_list) & df['cleaned_phone'].notna()]

    # 3. Missing/Failed
    missing = df[df['cleaned_phone'].isna()]

    # 4. Mobile numbers (usually 05X) - Very likely to be real
    mobiles = df[df['cleaned_phone'].str.startswith('05', na=False)]
    
    # 5. Landline (02, 03, 04, 08, 09) - Usually business direct
    landlines = df[df['cleaned_phone'].str.startswith(('02', '03', '04', '08', '09'), na=False)]

    print("--- [PHONE ANALYSIS REPORT] ---")
    print(f"Total Suppliers: {total}")
    print(f"Successful Extractions: {total - len(missing)}")
    print(f"Failed/Missing: {len(missing)}")
    print("-" * 30)
    print(f"PROBABLE PROXIES (072/073): {len(proxies)} ({len(proxies)/total:.1%})")
    print(f"DUPLICATED NUMBERS: {len(duplicated_rows)} (across {len(duplicates_list)} unique numbers)")
    print("-" * 30)
    print(f"LIKELY REAL MOBILE (05X): {len(mobiles)}")
    print(f"LIKELY REAL LANDLINE: {len(landlines)}")
    print("-" * 30)
    
    if len(proxies) > 0:
        print("\nSample of Proxy Numbers (072/073):")
        print(proxies[['Supplier Name', 'Real Phone']].head(10).to_string(index=False))

    if len(duplicated_rows) > 0:
        print("\nSample of Duplicated Numbers (Possible Portals):")
        print(duplicated_rows.sort_values('cleaned_phone')[['Supplier Name', 'Real Phone']].head(10).to_string(index=False))

if __name__ == "__main__":
    analyze()
