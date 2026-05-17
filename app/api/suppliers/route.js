import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const filePath = path.join(process.cwd(), 'engaged_suppliers_final_production.csv');
        
        if (!fs.existsSync(filePath)) {
            console.log("File not found at:", filePath);
            return NextResponse.json([]);
        }

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== "");
        
        if (lines.length < 2) return NextResponse.json([]);

        // More robust CSV parsing to handle commas inside quotes
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
        console.log("Headers found:", headers);

        const data = lines.slice(1).map(line => {
            const values = parseCSVLine(line);
            const obj = {};
            headers.forEach((header, index) => {
                const key = header.replace(/^"|"$/g, '').trim();
                obj[key] = values[index] ? values[index].replace(/^"|"$/g, '').trim() : "";
            });
            return obj;
        }).filter(item => {
            const phone = item["Real Phone"] || item["phone"]; // check both case variants
            return phone && phone !== "FAILED" && phone !== "N/A" && phone !== "";
        });

        console.log(`Parsed ${data.length} valid suppliers`);
        return NextResponse.json(data);
    } catch (error) {
        console.error("API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
