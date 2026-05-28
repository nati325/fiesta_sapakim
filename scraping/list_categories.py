import pandas as pd

df = pd.read_csv("engaged_suppliers_final_production.csv")
cats = df["Category"].value_counts()
print(f"Total suppliers: {len(df)}")
print("\nCategories:\n")
for cat, count in cats.items():
    print(f"  {count:3d}  {cat}")
