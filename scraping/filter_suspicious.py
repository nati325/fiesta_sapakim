import pandas as pd
import os

def identify_suspicious():
    input_file = 'engaged_suppliers_enriched.csv'
    output_fix_list = 'suppliers_to_fix.csv'
    output_clean = 'engaged_suppliers_clean.csv'
    
    if not os.path.exists(input_file):
        print(f"File {input_file} not found.")
        return

    df = pd.read_csv(input_file)
    
    def is_suspicious(phone):
        if pd.isna(phone) or str(phone).lower() in ['n/a', 'failed', '']:
            return True # Missing is also a reason to fix
        
        p = str(phone).replace('-', '').replace(' ', '').replace('(', '').replace(')', '')
        if p.startswith('+972'):
            p = '0' + p[4:]
            
        # 072 / 073 are definitely proxies
        if p.startswith(('072', '073')):
            return True
            
        # Suspicious 055 range (453/454)
        if p.startswith(('055453', '055454')):
            return True
            
        # Suspicious landlines (e.g., repeating portals)
        # Add more logic here if we identify other patterns
        
        return False

    df['is_suspicious'] = df['Real Phone'].apply(is_suspicious)
    
    # Also check for duplicates in non-suspicious numbers (if same number for 2+ suppliers)
    counts = df[~df['is_suspicious']]['Real Phone'].value_counts()
    dupes = counts[counts > 1].index.tolist()
    df.loc[df['Real Phone'].isin(dupes), 'is_suspicious'] = True

    to_fix = df[df['is_suspicious']]
    clean = df[~df['is_suspicious']]
    
    to_fix.to_csv(output_fix_list, index=False, encoding='utf-8-sig')
    clean.to_csv(output_clean, index=False, encoding='utf-8-sig')
    
    print(f"--- Identification Complete ---")
    print(f"Total: {len(df)}")
    print(f"Clean (likely real): {len(clean)}")
    print(f"To Fix (proxies/missing): {len(to_fix)}")
    print(f"Saved fix list to: {output_fix_list}")

if __name__ == "__main__":
    identify_suspicious()
