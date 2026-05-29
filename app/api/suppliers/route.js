import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import getMongoClient from '../../../lib/mongodb';

export const dynamic = 'force-dynamic';

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

function ensureJunction(src, dest) {
    try {
        if (!fs.existsSync(src)) {
            console.warn(`Junction source directory does not exist: ${src}`);
            return;
        }

        let exists = false;
        let isSymlink = false;
        let isDir = false;

        try {
            const stat = fs.lstatSync(dest);
            exists = true;
            isSymlink = stat.isSymbolicLink();
            isDir = stat.isDirectory();
        } catch (err) {
            // Dest does not exist
        }

        if (exists) {
            if (isSymlink) {
                try {
                    fs.unlinkSync(dest);
                } catch (e) {
                    console.error(`Failed to unlink existing symlink at ${dest}:`, e.message);
                }
            } else if (isDir) {
                const files = fs.readdirSync(dest);
                if (files.length === 0) {
                    fs.rmdirSync(dest);
                } else {
                    fs.renameSync(dest, dest + '_backup_' + Date.now());
                }
            } else {
                fs.unlinkSync(dest);
            }
        }

        const parentDir = path.dirname(dest);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        
        fs.symlinkSync(src, dest, 'junction');
        console.log(`Junction link created successfully from ${src} to ${dest}`);
    } catch (e) {
        console.error(`Failed to ensure junction for ${dest}:`, e.message);
    }
}


function ensureResourcesLinked() {
    try {
        const srcData = 'C:\\Users\\123\\Desktop\\scarping_for_fiesta\\data';
        const srcSuppliersMedia = 'C:\\Users\\123\\Desktop\\scarping_for_fiesta\\public\\media\\suppliers';
        const srcPortfoliosMedia = 'C:\\Users\\123\\Desktop\\scarping_for_fiesta\\public\\media\\portfolios';
        
        const destData = path.join(process.cwd(), 'data');
        const destSuppliersMedia = path.join(process.cwd(), 'public', 'media', 'suppliers');
        const destPortfoliosMedia = path.join(process.cwd(), 'public', 'media', 'portfolios');

        // 1. Copy JSON files from Data folder (fast, small)
        if (fs.existsSync(srcData)) {
            if (!fs.existsSync(destData)) {
                fs.mkdirSync(destData, { recursive: true });
            }
            const files = fs.readdirSync(srcData);
            files.forEach(file => {
                const srcFilePath = path.join(srcData, file);
                const destFilePath = path.join(destData, file);
                if (!fs.existsSync(destFilePath) || fs.statSync(srcFilePath).size !== fs.statSync(destFilePath).size) {
                    fs.copyFileSync(srcFilePath, destFilePath);
                }
            });
        }

        // 2. Ensure junctions for media directories
        ensureJunction(srcSuppliersMedia, destSuppliersMedia);
        ensureJunction(srcPortfoliosMedia, destPortfoliosMedia);

    } catch (e) {
        console.error("Error setting up resource links:", e.message);
    }
}

export async function GET() {
    try {
        // Run resource linking first (takes < 5ms if already linked)
        ensureResourcesLinked();

        console.log("GET /api/suppliers: Fetching from MongoDB...");

        // 1. Try reading from MongoDB first
        try {
            const client = await getMongoClient();
            const db = client.db('fiesta_crm');
            const collection = db.collection('suppliers');

            const dbSuppliers = await collection.find({}).toArray();
            console.log(`Fetched ${dbSuppliers.length} suppliers from MongoDB.`);

            if (dbSuppliers && dbSuppliers.length > 0) {
                const data = dbSuppliers.map(item => ({
                    "Supplier Name": item.name || "",
                    "Phone Number": item.phone || "",
                    "Category": item.category || "",
                    "URL": item.engaged_url || "",
                    "Main Image": item.main_image || "",
                    "Gallery": item.gallery || "",
                    "Real Phone": item.real_phone || "",
                    "Website": item.website || "",
                    "Google Rating": item.google_rating || "",
                    "Reviews Count": item.reviews_count || "",
                    "Address": item.address || "",
                    "description": item.description || "",
                    "reviews": item.reviews || [],
                    "images": item.images || []
                }));
                return NextResponse.json(data);
            }
        } catch (dbError) {
            console.error("MongoDB fetch failed, falling back to local files:", dbError.message);
        }

        // 2. Fallback: Try JSON (enriched data)
        const jsonPath = path.join(process.cwd(), 'data', 'suppliers_complete.json');
        if (fs.existsSync(jsonPath)) {
            console.log("Reading from fallback suppliers_complete.json");
            const fileContent = fs.readFileSync(jsonPath, 'utf-8');
            const rawData = JSON.parse(fileContent);
            const data = rawData.map(item => ({
                "Supplier Name": item.name || "",
                "Phone Number": item.phone || "",
                "Category": item.category || "",
                "URL": item.engaged_url || "",
                "Main Image": item.images && item.images.length > 0 ? item.images[0] : (item.google_image || ""),
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
            return NextResponse.json(data);
        }

        // 3. Fallback: Try CSV
        const csvPath = path.join(process.cwd(), 'scraping', 'engaged_suppliers_final_production.csv');
        if (!fs.existsSync(csvPath)) {
            console.log("No CSV fallback data source found");
            return NextResponse.json([]);
        }

        console.log("Falling back to CSV");
        const fileContent = fs.readFileSync(csvPath, 'utf-8');
        const lines = fileContent.split('\n').filter(line => line.trim());
        const headers = parseCSVLine(lines[0]);

        const data = lines.slice(1).map(line => {
            const values = parseCSVLine(line);
            const obj = {};
            headers.forEach((header, i) => {
                obj[header] = values[i] || '';
            });
            return obj;
        }).filter(item => {
            const phone = item["Real Phone"] || item["Phone Number"];
            return phone && phone !== "FAILED" && phone !== "N/A" && phone !== "";
        });

        // Load enriched data for reviews/images
        let reviewsMap = {};
        let imagesMap = {};
        let descriptionsMap = {};
        
        const reviewsPath = path.join(process.cwd(), 'data', 'supplier_reviews.json');
        const imagesPath = path.join(process.cwd(), 'data', 'supplier_images.json');
        const descPath = path.join(process.cwd(), 'data', 'supplier_descriptions.json');

        if (fs.existsSync(reviewsPath)) reviewsMap = JSON.parse(fs.readFileSync(reviewsPath, 'utf-8'));
        if (fs.existsSync(imagesPath)) imagesMap = JSON.parse(fs.readFileSync(imagesPath, 'utf-8'));
        if (fs.existsSync(descPath)) descriptionsMap = JSON.parse(fs.readFileSync(descPath, 'utf-8'));

        const enriched = data.map(item => {
            const name = item["Supplier Name"] || "";
            
            // Clean up image fields (avoid broken "nan" values)
            let mainImg = item["Main Image"] || "";
            if (mainImg === "nan") mainImg = "";
            let googleImg = item["Google Image"] || "";
            if (googleImg === "nan") googleImg = "";

            const rawImages = imagesMap[name]?.downloaded_images || [];
            const cleanImages = rawImages.filter(img => img && img !== "nan");

            return {
                ...item,
                "Main Image": mainImg,
                "Google Image": googleImg,
                "description": descriptionsMap[name] || "",
                "reviews": reviewsMap[name] || [],
                "images": cleanImages
            };
        });

        return NextResponse.json(enriched);

    } catch (error) {
        console.error("API Error during GET:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        const { phone, name, images, description, reviews } = await req.json();
        
        if (!phone) {
            return NextResponse.json({ error: "Missing supplier phone" }, { status: 400 });
        }
        
        const updateFields = {};
        if (images !== undefined) updateFields.images = images;
        if (description !== undefined) updateFields.description = description;
        if (reviews !== undefined) updateFields.reviews = reviews;
        
        if (Object.keys(updateFields).length === 0) {
            return NextResponse.json({ error: "No fields to update" }, { status: 400 });
        }
        
        // 1. Update in MongoDB
        try {
            const client = await getMongoClient();
            const db = client.db('fiesta_crm');
            const collection = db.collection('suppliers');
            
            const result = await collection.updateOne(
                { phone: phone },
                { $set: updateFields }
            );
            console.log(`Updated supplier ${phone} fields in MongoDB:`, Object.keys(updateFields));
        } catch (dbError) {
            console.error("MongoDB update failed:", dbError.message);
        }
        
        // 2. Update local fallback JSON file suppliers_complete.json
        const jsonPath = path.join(process.cwd(), 'data', 'suppliers_complete.json');
        if (fs.existsSync(jsonPath)) {
            try {
                const fileContent = fs.readFileSync(jsonPath, 'utf-8');
                const rawData = JSON.parse(fileContent);
                let updated = false;
                
                const updatedData = rawData.map(item => {
                    const itemPhone = item.real_phone || item.phone || "";
                    if (itemPhone === phone) {
                        updated = true;
                        return { ...item, ...updateFields };
                    }
                    return item;
                });
                
                if (updated) {
                    fs.writeFileSync(jsonPath, JSON.stringify(updatedData, null, 2), 'utf-8');
                    console.log(`Updated supplier ${phone} fields in local suppliers_complete.json.`);
                }
            } catch (jsonError) {
                console.error("Failed to update local JSON fallback:", jsonError.message);
            }
        }
        
        // 3. Update data/supplier_descriptions.json if description was updated and name was provided
        if (description !== undefined && name) {
            const descPath = path.join(process.cwd(), 'data', 'supplier_descriptions.json');
            if (fs.existsSync(descPath)) {
                try {
                    const fileContent = fs.readFileSync(descPath, 'utf-8');
                    const descData = JSON.parse(fileContent);
                    descData[name] = {
                        description: description,
                        source: "agent_edited",
                        last_updated: new Date().toISOString().replace('T', ' ').substring(0, 19)
                    };
                    fs.writeFileSync(descPath, JSON.stringify(descData, null, 2), 'utf-8');
                    console.log(`Updated supplier ${name} description in supplier_descriptions.json.`);
                } catch (descError) {
                    console.error("Failed to update supplier_descriptions.json:", descError.message);
                }
            }
        }

        // 4. Update data/supplier_reviews.json if reviews were updated and name was provided
        if (reviews !== undefined && name) {
            const reviewsPath = path.join(process.cwd(), 'data', 'supplier_reviews.json');
            if (fs.existsSync(reviewsPath)) {
                try {
                    const fileContent = fs.readFileSync(reviewsPath, 'utf-8');
                    const reviewsData = JSON.parse(fileContent);
                    reviewsData[name] = reviews;
                    fs.writeFileSync(reviewsPath, JSON.stringify(reviewsData, null, 2), 'utf-8');
                    console.log(`Updated supplier ${name} reviews in supplier_reviews.json.`);
                } catch (reviewsError) {
                    console.error("Failed to update supplier_reviews.json:", reviewsError.message);
                }
            }
        }
        
        return NextResponse.json({ success: true });
        
    } catch (error) {
        console.error("API Error during POST:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
