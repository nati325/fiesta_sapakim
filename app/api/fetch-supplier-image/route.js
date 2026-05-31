/**
 * /api/fetch-supplier-image
 * Fetches a supplier's engaged.co.il page server-side and extracts the main image URL.
 * Returns the image URL to the client dashboard.
 */
import { NextResponse } from 'next/server';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Referer': 'https://engaged.co.il/',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

function extractImages(html) {
  const results = [];

  const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/i)
    || html.match(/content="([^"]+)"\s+property="og:image"/i);
  if (ogMatch && ogMatch[1].startsWith('http') && !ogMatch[1].includes('logo_new')) {
    results.push({ url: ogMatch[1], type: 'og' });
  }

  // Search only top of page — before sidebar recommendations
  const top = html.slice(0, Math.floor(html.length * 0.45));

  const galleryRegex = /\/\/images\/stories\/deals\/(\d+)\/images\/resize\/([^"'\s]+?)_small\.(jpg|jpeg|png)/gi;
  let m;
  while ((m = galleryRegex.exec(top)) !== null) {
    const largeUrl = `https://engaged.co.il/images/stories/deals/${m[1]}/images/resize/${m[2]}_large.${m[3]}`;
    results.push({ url: largeUrl, type: 'gallery', dealId: m[1] });
  }

  const logoRegex = /\/images\/stories\/deals\/(\d+)\/logo\/resize\/([^"'\s]+?)_tiny\.(jpg|jpeg|png)/gi;
  while ((m = logoRegex.exec(top)) !== null) {
    const url = `https://engaged.co.il/images/stories/deals/${m[1]}/logo/resize/${m[2]}_small.${m[3]}`;
    results.push({ url, type: 'logo', dealId: m[1] });
  }

  return results;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const engagedUrl = searchParams.get('url');
  const phone = searchParams.get('phone') || '';

  if (!engagedUrl) {
    return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(engagedUrl, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 200, statusCode: res.status });
    }

    const html = await res.text();
    const images = extractImages(html);

    const firstGallery = images.find(i => i.type === 'gallery');
    const ogImage = images.find(i => i.type === 'og');
    const firstLogo = images.find(i => i.type === 'logo');

    const best = ogImage?.url || firstGallery?.url || firstLogo?.url || null;

    return NextResponse.json({
      imageUrl: best,
      allImages: images.slice(0, 10),
      phone,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 200 });
  }
}
