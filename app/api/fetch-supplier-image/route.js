/**
 * /api/fetch-supplier-image
 * Fetches owner-published images: Google profile, Instagram, website — not engaged sidebar ads.
 */
import { NextResponse } from 'next/server';
import { isBadEngagedImage, isBadImageUrl } from '../../../lib/supplierImageSources.js';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
};

function extractOgImage(html) {
  if (!html) return null;
  const match =
    html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const url = match?.[1]?.trim();
  if (!url || !url.startsWith('http')) return null;
  if (isBadImageUrl(url)) return null;
  return url;
}

async function fetchHtml(url, referer) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: referer || url,
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryOgFromUrl(url, source, referer) {
  const html = await fetchHtml(url, referer);
  const imageUrl = extractOgImage(html);
  if (!imageUrl || isBadImageUrl(imageUrl)) return null;
  return { imageUrl, source, pageUrl: url };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const phone = searchParams.get('phone') || '';
  const googleImage = searchParams.get('googleImage') || '';
  const website = searchParams.get('website') || '';
  const instagramRaw = searchParams.get('instagram') || '';
  const engagedUrl = searchParams.get('url') || '';

  const instagramUrls = instagramRaw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    if (googleImage.startsWith('http') && !isBadImageUrl(googleImage)) {
      return NextResponse.json({ imageUrl: googleImage, source: 'google', phone });
    }

    for (const instaUrl of instagramUrls) {
      const result = await tryOgFromUrl(instaUrl, 'instagram', 'https://www.instagram.com/');
      if (result) return NextResponse.json({ ...result, phone });
    }

    if (website.startsWith('http')) {
      const result = await tryOgFromUrl(website, 'website', website);
      if (result) return NextResponse.json({ ...result, phone });
    }

    if (engagedUrl.startsWith('http')) {
      const result = await tryOgFromUrl(engagedUrl, 'engaged-og', 'https://engaged.co.il/');
      if (result && !isBadEngagedImage(result.imageUrl) && !isBadImageUrl(result.imageUrl)) {
        return NextResponse.json({ ...result, phone });
      }
    }

    return NextResponse.json({ imageUrl: null, phone, error: 'no owner image found' });
  } catch (err) {
    return NextResponse.json({ error: err.message, phone }, { status: 200 });
  }
}
