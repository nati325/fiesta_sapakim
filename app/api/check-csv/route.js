import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { loadSuppliersFromJson } from '../../../lib/supplierEnrichment';
import { supplierMatchesSearch } from '../../../lib/searchUtils';

export const dynamic = 'force-dynamic';

const YINON_CATS = ['מוזיקה', "די ג'יי", 'DJ', "דיג'יי", 'תקליטן'];

function yinonVisible(s) {
  const cat = s.Category || '';
  if (!cat || cat === 'ספקים ללא קטגוריה') return true;
  return YINON_CATS.some((c) => cat.includes(c));
}

function buildDashboardReport() {
  const { list } = loadSuppliersFromJson();
  const lior = list.find(
    (s) =>
      (s['Supplier Name'] || '').includes('ליאור פרץ') ||
      (s.clean_name || '').includes('ליאור פרץ')
  );
  const liorIndex = lior ? list.indexOf(lior) + 1 : null;

  const emptyNames = list.filter((s) => {
    const name = (s['Supplier Name'] || '').trim();
    return !name || name === 'ספק ללא שם';
  });

  const searchTests = ['ליאור פרץ', 'ליאר פרץ', '407', '40'].map((query) => ({
    query,
    matchCount: list.filter((s, i) => supplierMatchesSearch(s, query, i + 1)).length,
    liorMatches: lior ? supplierMatchesSearch(lior, query, liorIndex) : false,
  }));

  return {
    ok: true,
    source: 'json',
    totalSuppliers: list.length,
    emptyNames: emptyNames.length,
    yinonVisibleCount: list.filter(yinonVisible).length,
    lior: lior
      ? {
          found: true,
          name: lior['Supplier Name'],
          clean_name: lior.clean_name,
          category: lior.Category,
          realPhone: lior['Real Phone'],
          index: liorIndex,
          visibleToYinon: yinonVisible(lior),
        }
      : { found: false },
    searchTests,
    hint: 'ליאור פרץ מסומן כ-contract ב-MongoDB → מופיע בלשונית "ספקים שטופלו"',
  };
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        if (searchParams.get('dashboard') === '1' || searchParams.get('verify') === '1') {
            return NextResponse.json(buildDashboardReport());
        }

        const filePath = path.join(process.cwd(), 'scraping', 'engaged_suppliers_final_production.csv');
        
        if (!fs.existsSync(filePath)) {
            return NextResponse.json({ error: "File not found" });
        }

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== "");
        
        if (lines.length < 2) return NextResponse.json({ error: "Empty file" });

        const parseCSVLine = (text) => {
            const result = [];
            let cell = '';
            let inQuotes = false;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if (char === '"') inQuotes = !inQuotes;
                else if (char === ',' && !inQuotes) {
                    result.push(cell.trim());
                    cell = '';
                } else {
                    cell += char;
                }
            }
            result.push(cell.trim());
            return result;
        };

        const headers = parseCSVLine(lines[0]);
        const data = lines.slice(1).map(line => {
            const values = parseCSVLine(line);
            const obj = {};
            headers.forEach((header, index) => {
                const key = header.replace(/^"|"$/g, '').trim();
                obj[key] = values[index] ? values[index].replace(/^"|"$/g, '').trim() : "";
            });
            return obj;
        });

        // Total rows in CSV
        const totalRows = data.length;

        // Valid rows (having phone number)
        const validRows = data.filter(item => {
            const phone = item["Real Phone"] || item["phone"];
            return phone && phone !== "FAILED" && phone !== "N/A" && phone !== "";
        });

        const totalValid = validRows.length;

        // Statistics for valid rows
        const stats = {
            totalRows,
            totalValid,
            hasMainImage: 0,
            hasGoogleImage: 0,
            hasAnyImage: 0,
            hasGoogleReviewsLink: 0,
            hasGoogleRating: 0,
            missingImageSuppliers: [],
            missingReviewsLinkSuppliers: [],
            missingRatingSuppliers: []
        };

        validRows.forEach(item => {
            const name = item["Supplier Name"];
            const mainImg = item["Main Image"];
            const googleImg = item["Google Image"];
            const reviewsLink = item["Google Reviews Link"];
            const rating = parseFloat(item["Google Rating"]) || 0;

            const hasMain = mainImg && mainImg.trim() !== "";
            const hasGoogleImg = googleImg && googleImg.trim() !== "";
            const hasAnyImg = hasMain || hasGoogleImg;
            const hasLink = reviewsLink && reviewsLink.trim() !== "";
            const hasRating = rating > 0;

            if (hasMain) stats.hasMainImage++;
            if (hasGoogleImg) stats.hasGoogleImage++;
            if (hasAnyImg) stats.hasAnyImage++;
            if (hasLink) stats.hasGoogleReviewsLink++;
            if (hasRating) stats.hasGoogleRating++;

            if (!hasAnyImg) {
                stats.missingImageSuppliers.push({ name, category: item["Category"] });
            }
            if (!hasLink) {
                stats.missingReviewsLinkSuppliers.push({ name, category: item["Category"] });
            }
            if (!hasRating) {
                stats.missingRatingSuppliers.push({ name, category: item["Category"] });
            }
        });

        return NextResponse.json({
            success: true,
            stats: {
                totalRows: stats.totalRows,
                totalValid: stats.totalValid,
                hasMainImage: stats.hasMainImage,
                hasGoogleImage: stats.hasGoogleImage,
                hasAnyImage: stats.hasAnyImage,
                hasGoogleReviewsLink: stats.hasGoogleReviewsLink,
                hasGoogleRating: stats.hasGoogleRating,
                percentWithImage: ((stats.hasAnyImage / stats.totalValid) * 100).toFixed(1) + "%",
                percentWithReviewsLink: ((stats.hasGoogleReviewsLink / stats.totalValid) * 100).toFixed(1) + "%",
                percentWithRating: ((stats.hasGoogleRating / stats.totalValid) * 100).toFixed(1) + "%"
            },
            missingImageSample: stats.missingImageSuppliers.slice(0, 15),
            missingReviewsLinkSample: stats.missingReviewsLinkSuppliers.slice(0, 15),
            missingRatingSample: stats.missingRatingSuppliers.slice(0, 15),
            totalMissingImage: stats.missingImageSuppliers.length,
            totalMissingReviewsLink: stats.missingReviewsLinkSuppliers.length,
            totalMissingRating: stats.missingRatingSuppliers.length
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
