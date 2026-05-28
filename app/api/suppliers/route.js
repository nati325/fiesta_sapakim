import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const filePath = path.join(process.cwd(), 'data', 'suppliers_complete.json');
        
        if (!fs.existsSync(filePath)) {
            console.log("File not found at:", filePath);
            return NextResponse.json([]);
        }

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const rawData = JSON.parse(fileContent);

        const data = rawData.map(item => ({
            "Supplier Name": item.name || "",
            "Phone Number": item.phone || "",
            "Category": item.category || "",
            "URL": item.engaged_url || "",
            "Main Image": item.images && item.images.length > 0 ? item.images[0] : "",
            "Gallery": item.images ? item.images.join(",") : "",
            "Real Phone": item.real_phone || "",
            "Website": item.website || "",
            "Google Rating": item.google_rating === "nan" ? "" : item.google_rating,
            "Reviews Count": item.reviews_count === "nan" ? "" : item.reviews_count,
            "Address": item.address || "",
            "description": item.description || "",
            "reviews": item.reviews || [],
            "images": item.images || []
        })).filter(item => {
            const phone = item["Real Phone"] || item["Phone Number"];
            return phone && phone !== "FAILED" && phone !== "N/A" && phone !== "";
        });

        console.log(`Parsed ${data.length} valid suppliers from JSON`);
        return NextResponse.json(data);
    } catch (error) {
        console.error("API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
