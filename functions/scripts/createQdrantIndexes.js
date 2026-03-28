/**
 * One-time script to create required payload indexes on the Qdrant collection.
 *
 * Usage (from functions/):
 *   node scripts/createQdrantIndexes.js
 *
 * Reads QDRANT_URL and LOCAL_QDRANT_API_KEY from .env automatically.
 * You can also override via env vars:
 *   QDRANT_URL=... QDRANT_API_KEY=... node scripts/createQdrantIndexes.js
 * 
 * cd /Users/midhun.singu/InnerTherapist-BE/functions && node scripts/createQdrantIndexes.js
 */
require("dotenv").config();
const { QdrantClient } = require("@qdrant/js-client-rest");

const COLLECTION_NAME = "user_insights";

async function main() {
    const qdrant = new QdrantClient({
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY || process.env.LOCAL_QDRANT_API_KEY,
    });

    console.log(`Creating payload indexes on "${COLLECTION_NAME}"...`);

    await qdrant.createPayloadIndex(COLLECTION_NAME, {
        field_name: "uid",
        field_schema: "keyword",
    });
    console.log('  ✓ "uid" (keyword)');

    await qdrant.createPayloadIndex(COLLECTION_NAME, {
        field_name: "date",
        field_schema: "datetime",
    });
    console.log('  ✓ "date" (datetime)');

    await qdrant.createPayloadIndex(COLLECTION_NAME, {
        field_name: "type",
        field_schema: "keyword",
    });
    console.log('  ✓ "type" (keyword)');

    console.log("Done. All indexes created.");
}

main().catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
});
