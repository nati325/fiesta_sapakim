import requests
import re

# Check a typical engaged.co.il supplier page for portfolio links
url = "https://engaged.co.il/המלצות/sia-events.html"
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

res = requests.get(url, headers=headers, timeout=15)
print(f"Status: {res.status_code}")
print(f"URL: {url}\n")

# Look for portfolio / gallery links
html = res.text

# Search for links containing gallery/portfolio keywords
links = re.findall(r'href=["\']([^"\']+)["\']', html)
portfolio_links = [l for l in links if any(kw in l.lower() for kw in ['gallery', 'portfolio', 'תיק', 'גלריה', 'album', 'photo'])]
print("Portfolio-like links found:")
for l in portfolio_links[:20]:
    print(f"  {l}")

# Also check for image gallery elements
gallery_hints = re.findall(r'(gallery|portfolio|lightbox|תיק עבודות|גלריה)[^<]{0,200}', html, re.IGNORECASE)
print(f"\nGallery hints in page: {len(gallery_hints)}")
for h in gallery_hints[:5]:
    print(f"  ...{h[:150]}...")

# Show all unique image URLs from the page
img_urls = re.findall(r'src=["\']([^"\']+\.(jpg|jpeg|png|webp))["\']', html, re.IGNORECASE)
print(f"\nImage URLs on page: {len(img_urls)}")
for url_img, _ in img_urls[:15]:
    print(f"  {url_img[:100]}")
