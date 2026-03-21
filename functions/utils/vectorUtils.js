const axios = require("axios");
const { QdrantClient } = require("@qdrant/js-client-rest");
const { v5: uuidv5 } = require("uuid");
const { defineSecret } = require("firebase-functions/params");

const QDRANT_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const COLLECTION_NAME = "user_insights";

const qdrantApiKey = defineSecret("QDRANT_API_KEY");

async function generateEmbedding(text, geminiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`;
    const response = await axios.post(url, {
        content: { parts: [{ text }] },
        outputDimensionality: 768,
    });
    return response.data.embedding.values;
}

function generatePointId(uid, type, sourceId) {
    return uuidv5(`${uid}:${type}:${sourceId}`, QDRANT_NAMESPACE);
}

async function upsertPoint(id, vector, payload) {
    const qdrant = new QdrantClient({
        url: process.env.QDRANT_URL,
        apiKey: process.env.LOCAL_QDRANT_API_KEY || qdrantApiKey.value(),
    });
    await qdrant.upsert(COLLECTION_NAME, {
        wait: true,
        points: [{ id, vector, payload }],
    });
}

module.exports = { generateEmbedding, generatePointId, upsertPoint };
