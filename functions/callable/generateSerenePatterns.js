const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { getFirestore } = require("firebase-admin/firestore");
const { QdrantClient } = require("@qdrant/js-client-rest");
const axios = require("axios");
const { generateEmbedding } = require("../utils/vectorUtils");

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const qdrantApiKey = defineSecret("QDRANT_API_KEY");

const COLLECTION_NAME = "user_insights";

const FALLBACK = {
    segments: [
        { type: "regular", text: "I'm still getting to know you. Keep journalling and checking in — " },
        { type: "emphasized", text: "patterns will emerge soon" },
        { type: "regular", text: "." },
    ],
};

const VALID_PERIODS = ["week", "fortnight", "month", "all"];
const PERIOD_DAYS = { week: 7, fortnight: 14, month: 30, all: null };

exports.generateSerenePatterns = onCall(
    { secrets: [geminiApiKey, qdrantApiKey] },
    async (request) => {
        const uid = request.auth?.uid;
        if (!uid) {
            throw new HttpsError("unauthenticated", "Login required");
        }

        const period = request.data?.period || "week";
        if (!VALID_PERIODS.includes(period)) {
            throw new HttpsError(
                "invalid-argument",
                "period must be week, fortnight, month, or all"
            );
        }

        try {
            const db = getFirestore();
            const daysBack = PERIOD_DAYS[period];
            let dateFilter = null;
            if (daysBack) {
                const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString();
                dateFilter = { key: "date", range: { gte: cutoff } };
            }

            const userDoc = await db.collection("Users").doc(uid).get();
            const onboarding = userDoc.data()?.onboarding || {};

            const geminiKey = process.env.GEMINI_SECRET || geminiApiKey.value();

            const queryText = "Emotional patterns, mood trends, energy levels, stress triggers, coping behaviors, sleep quality, journaling impact, resilience indicators, and behavioral patterns over time.";
            const queryEmbedding = await generateEmbedding(queryText, geminiKey);

            const qdrant = new QdrantClient({
                url: process.env.QDRANT_URL,
                apiKey: process.env.LOCAL_QDRANT_API_KEY || qdrantApiKey.value(),
            });

            const mustFilters = [{ key: "uid", match: { value: uid } }];
            if (dateFilter) mustFilters.push(dateFilter);

            const searchResults = await qdrant.search(COLLECTION_NAME, {
                vector: queryEmbedding,
                limit: 30,
                filter: { must: mustFilters },
                with_payload: true,
            });

            logger.info(`Qdrant search for user ${uid}, period: ${period}, found ${searchResults.length} results`);

            if (searchResults.length === 0) return FALLBACK;

            const contextChunks = searchResults.map((r) => r.payload?.text || "").filter(Boolean).join("\n\n");

            const prompt = `You are Serene, a warm and compassionate AI therapy companion inside the "Inner Therapist" app.
You are generating a brief pattern observation for the user's Progress screen.

USER PROFILE:
- Name: ${onboarding.name || "the user"}
- Age: ${onboarding.age || "unknown"}
- What brought them here: ${(onboarding.bringsMeHere || []).join(", ") || "not specified"}
- Stress triggers: ${(onboarding.triggers || []).join(", ") || "not specified"}
- Life areas out of balance: ${(onboarding.lifeBalance || []).join(", ") || "not specified"}
- Improvement goal: ${onboarding.improvementGoal || "not specified"}
- Support style preference: ${onboarding.supportStyle || "not specified"}

TIME PERIOD: ${period} (last ${daysBack || "all"} days)

USER DATA FROM THIS PERIOD:
${contextChunks}

INSTRUCTIONS:
1. Analyze the user data and identify 1-2 key patterns.
2. Generate a brief, warm insight (2-3 sentences maximum).
3. Be observational, not prescriptive. Notice patterns, don't give advice.
4. Reference specific data points where possible.
5. Address the user by name occasionally.

FORMAT YOUR RESPONSE AS VALID JSON ONLY (no markdown, no code fences):
{
  "segments": [
    {"type": "regular", "text": "Your mornings after journalling averaged "},
    {"type": "emphasized", "text": "4.2 mood"},
    {"type": "regular", "text": " vs 2.9 without."}
  ]
}

RULES FOR SEGMENTS:
- "regular" = normal body text
- "emphasized" = ONLY for key data points, numbers, metrics, or impactful short phrases
- Each segment's text must flow naturally into the next when concatenated
- Total output: 2-3 sentences
- No markdown in text values
- Response must be valid JSON only, nothing else`;

            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
            const geminiRes = await axios.post(geminiUrl, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" },
            });

            const aiText = geminiRes.data.candidates[0].content.parts[0].text;
            const parsed = JSON.parse(aiText);

            if (!parsed.segments || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
                return FALLBACK;
            }

            logger.info('Generated Serene patterns for user');
            return parsed;
        } catch (err) {
            logger.error('generateSerenePatterns failed for user \${uid}: \${err.message}');
            return FALLBACK;
        }
    }
);
