import pandas as pd
import os

def finalize():
    enriched_file = 'engaged_suppliers_enriched.csv'
    fixed_file = 'suppliers_fixed_results.csv'
    output_file = 'engaged_suppliers_final_production.csv'
    
    if not os.path.exists(enriched_file) or not os.path.exists(fixed_file):
        print("Missing required files.")
        return

    # Load data
    df_main = pd.read_csv(enriched_file)
    df_fixed = pd.read_csv(fixed_file)
    
    print(f"Total suppliers in main file: {len(df_main)}")
    print(f"Total suppliers attempted to fix: {len(df_fixed)}")
    
    # Create a mapping of URL -> Fixed Phone
    # We only take phones that are NOT 'N/A' and NOT 'PROXY_ONLY'
    valid_fixes = df_fixed[~df_fixed['Fixed Phone'].isin(['N/A', 'PROXY_ONLY', 'FAILED'])]
    fix_map = dict(zip(valid_fixes['URL'], valid_fixes['Fixed Phone']))
    
    print(f"Successful unique fixes found: {len(valid_fixes)}")
    
    # Apply the fixes
    count = 0
    def apply_fix(row):
        nonlocal count
        url = row['URL']
        if url in fix_map:
            count += 1
            return fix_map[url]
        return row['Real Phone']

    df_main['Real Phone'] = df_main.apply(apply_fix, axis=1)
    
    # Final cleanup of the 'Real Phone' column (ensure strings)
    df_main['Real Phone'] = df_main['Real Phone'].fillna('')
    
    # Save final version
    df_main.to_csv(output_file, index=False, encoding='utf-8-sig')
    
    print("-" * 30)
    print(f"DONE! Integrated {count} fixes.")
    print(f"Final production file saved to: {output_file}")
    print("-" * 30)

if __name__ == "__main__":
    finalize()
