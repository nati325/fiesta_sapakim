import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import getMongoClient from '../../../lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
    const srcData = 'C:\\Users\\123\\Desktop\\scarping_for_fiesta\\data';
    const srcSuppliersMedia = 'C:\\Users\\123\\Desktop\\scarping_for_fiesta\\public\\media\\suppliers';
    const srcPortfoliosMedia = 'C:\\Users\\123\\Desktop\\scarping_for_fiesta\\public\\media\\portfolios';
    
    const destData = path.join(process.cwd(), 'data');
    const destSuppliersMedia = path.join(process.cwd(), 'public', 'media', 'suppliers');
    const destPortfoliosMedia = path.join(process.cwd(), 'public', 'media', 'portfolios');

    const status = {
        processCwd: process.cwd(),
        srcDataExists: fs.existsSync(srcData),
        srcSuppliersMediaExists: fs.existsSync(srcSuppliersMedia),
        srcPortfoliosMediaExists: fs.existsSync(srcPortfoliosMedia),
        destDataExists: fs.existsSync(destData),
        destSuppliersMediaExists: fs.existsSync(destSuppliersMedia),
        destPortfoliosMediaExists: fs.existsSync(destPortfoliosMedia),
    };

    try {
        // 1. Copy JSON files from Data folder (fast, small)
        if (status.srcDataExists) {
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
            status.dataCopySuccess = true;
        }

        // 2. Create Junction for suppliers media
        if (status.srcSuppliersMediaExists) {
            if (fs.existsSync(destSuppliersMedia)) {
                const stat = fs.lstatSync(destSuppliersMedia);
                if (stat.isDirectory() && !stat.isSymbolicLink()) {
                    const files = fs.readdirSync(destSuppliersMedia);
                    if (files.length === 0) {
                        fs.rmdirSync(destSuppliersMedia);
                    } else {
                        fs.renameSync(destSuppliersMedia, destSuppliersMedia + '_backup_' + Date.now());
                    }
                } else if (stat.isSymbolicLink()) {
                    fs.unlinkSync(destSuppliersMedia);
                }
            }
            
            if (!fs.existsSync(destSuppliersMedia)) {
                fs.symlinkSync(srcSuppliersMedia, destSuppliersMedia, 'junction');
                status.suppliersJunctionCreated = true;
            }
        }

        // 3. Create Junction for portfolios media
        if (status.srcPortfoliosMediaExists) {
            if (fs.existsSync(destPortfoliosMedia)) {
                const stat = fs.lstatSync(destPortfoliosMedia);
                if (stat.isDirectory() && !stat.isSymbolicLink()) {
                    const files = fs.readdirSync(destPortfoliosMedia);
                    if (files.length === 0) {
                        fs.rmdirSync(destPortfoliosMedia);
                    } else {
                        fs.renameSync(destPortfoliosMedia, destPortfoliosMedia + '_backup_' + Date.now());
                    }
                } else if (stat.isSymbolicLink()) {
                    fs.unlinkSync(destPortfoliosMedia);
                }
            }

            if (!fs.existsSync(destPortfoliosMedia)) {
                fs.symlinkSync(srcPortfoliosMedia, destPortfoliosMedia, 'junction');
                status.portfoliosJunctionCreated = true;
            }
        }

        // 4. Read suppliers_complete.json and sync to MongoDB
        const jsonPath = path.join(destData, 'suppliers_complete.json');
        if (fs.existsSync(jsonPath)) {
            status.jsonFound = true;
            const fileContent = fs.readFileSync(jsonPath, 'utf-8');
            const rawData = JSON.parse(fileContent);

            status.rawSuppliersCount = rawData.length;

            const client = await getMongoClient();
            const db = client.db('fiesta_crm');
            const collection = db.collection('suppliers');

            // Bulk Upsert suppliers to MongoDB
            const bulkOps = rawData.map(item => {
                const phone = item.real_phone || item.phone || "";
                return {
                    updateOne: {
                        filter: { phone: phone },
                        update: {
                            $set: {
                                name: item.name || "",
                                phone: phone,
                                category: item.category || "",
                                engaged_url: item.engaged_url || "",
                                main_image: item.images && item.images.length > 0 ? item.images[0] : (item.google_image || ""),
                                gallery: item.images ? item.images.join(",") : "",
                                real_phone: item.real_phone || "",
                                website: item.website || "",
                                google_rating: item.google_rating === "nan" ? "" : item.google_rating,
                                reviews_count: item.reviews_count === "nan" ? "" : item.reviews_count,
                                address: item.address || "",
                                description: item.description || "",
                                reviews: item.reviews || [],
                                images: item.images || []
                            }
                        },
                        upsert: true
                    }
                };
            }).filter(op => op.updateOne.filter.phone !== ""); // Filter out invalid phones

            status.validSuppliersToSync = bulkOps.length;

            if (bulkOps.length > 0) {
                const result = await collection.bulkWrite(bulkOps);
                status.mongoSyncResult = {
                    matchedCount: result.matchedCount,
                    modifiedCount: result.modifiedCount,
                    upsertedCount: result.upsertedCount,
                    upsertedIdsCount: Object.keys(result.upsertedIds).length
                };
                status.mongoSyncSuccess = true;
            }
        }

        status.finalDestDataFiles = fs.existsSync(destData) ? fs.readdirSync(destData) : [];
        status.finalDestSuppliersMediaExists = fs.existsSync(destSuppliersMedia);
        status.finalDestSuppliersMediaCount = fs.existsSync(destSuppliersMedia) ? fs.readdirSync(destSuppliersMedia).length : 0;

    } catch (e) {
        status.error = e.message;
        status.errorStack = e.stack;
    }

    return NextResponse.json(status);
}
