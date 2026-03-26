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
    statusLine: "Thinking of something for you...",
    message: {
        body: "You've been carrying a lot lately. There might be something worth looking at together — not the situation, but the story you're telling yourself about what it means.",
        highlightedPhrase: null,
    },
    contextSources: [],
    ctaLabel: "Open session with Serene",
};

exports.generateSereneNudge = onCall(
    { secrets: [geminiApiKey, qdrantApiKey] },
    async (request) => {
        const uid = request.auth?.uid;
        if (!uid) {
            throw new HttpsError("unauthenticated", "Login required");
        }

        try {
            const db = getFirestore();

            // 1. Fetch onboarding profile
            const userDoc = await db.collection("Users").doc(uid).get();
            const onboarding = userDoc.data()?.onboarding || {};

            // 2. Generate query embedding
            const geminiKey = process.env.GEMINI_SECRET || geminiApiKey.value();
            const queryText =
                "Recent emotional themes, recurring concerns, unresolved feelings, and conversation topics the user has been processing.";
            const queryEmbedding = await generateEmbedding(queryText, geminiKey);

            // 3. Search Qdrant — last 14 days
            const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();

            const qdrant = new QdrantClient({
                url: process.env.QDRANT_URL,
                apiKey: process.env.LOCAL_QDRANT_API_KEY || qdrantApiKey.value(),
            });

            const results = await qdrant.search(COLLECTION_NAME, {
                vector: queryEmbedding,
                limit: 20,
                filter: {
                    must: [
                        { key: "uid", match: { value: uid } },
                        { key: "date", range: { gte: cutoff } },
                    ],
                },
                with_payload: true,
            });

            logger.info(`Nudge search for user ${uid}, found ${results.length} results`);

            if (results.length === 0) return FALLBACK;

            // 4. Build context + count sources by type
            const contextChunks = results.map((r) => r.payload?.text || "").filter(Boolean).join("\n\n");

            const typeCounts = {};
            for (const r of results) {
                const t = r.payload.type || "unknown";
                typeCounts[t] = (typeCounts[t] || 0) + 1;
            }

            const sourceLabels = [];
            if (typeCounts.journal)
                sourceLabels.push(
                    `${typeCounts.journal} journal ${typeCounts.journal === 1 ? "entry" : "entries"}`
                );
            if (typeCounts.daily_checkin)
                sourceLabels.push(
                    `${typeCounts.daily_checkin} check-${typeCounts.daily_checkin === 1 ? "in" : "ins"}`
                );
            if (typeCounts.serene_session)
                sourceLabels.push(
                    `${typeCounts.serene_session} ${typeCounts.serene_session === 1 ? "session" : "sessions"}`
                );
            if (typeCounts.morning_motivation)
                sourceLabels.push(
                    `${typeCounts.morning_motivation} ${typeCounts.morning_motivation === 1 ? "reflection" : "reflections"}`
                );

            // 5. Call Gemini
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

            const prompt = `You are Serene, a warm and compassionate AI therapy companion.
You are generating a personalised nudge message for the user's home screen.

USER PROFILE:
- Name: ${onboarding.name || "the user"}
- What brought them here: ${(onboarding.bringsMeHere || []).join(", ") || "not specified"}
- Improvement goal: ${onboarding.improvementGoal || "not specified"}

USER DATA FROM THE LAST 14 DAYS:
${contextChunks}

INSTRUCTIONS:
1. Identify the most emotionally significant recurring theme from the data.
2. Write a warm, inviting message (2-3 sentences) that references specific things the user has shared.
3. The tone should feel like a thoughtful friend noticing something meaningful — not clinical.
4. Make the user want to open a session to explore further.

FORMAT YOUR RESPONSE AS VALID JSON ONLY (no markdown, no code fences):
{
  "statusLine": "Noticed something in your reflections...",
  "body": "You mentioned feeling dismissed at work three times this month. I've been sitting with that. I think there's something worth looking at together.",
  "highlightedPhrase": "dismissed at work"
}

RULES:
- "statusLine": a short teaser line (5-10 words), e.g. "I noticed a thread in your entries..."
- "body": the main message, 2-3 sentences, warm and personal
- "highlightedPhrase": a 2-4 word substring of body that captures the key theme. Set to null if nothing stands out.
- Response must be valid JSON only, nothing else`;

            const geminiRes = await axios.post(geminiUrl, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" },
            });

            const aiText = geminiRes.data.candidates[0].content.parts[0].text;
            const parsed = JSON.parse(aiText);

            logger.info(`Generated Serene nudge for user ${uid}`);

            return {
                statusLine: parsed.statusLine || "Thinking of something for you...",
                message: {
                    body: parsed.body || FALLBACK.message.body,
                    highlightedPhrase: parsed.highlightedPhrase || null,
                },
                contextSources: sourceLabels.map((label) => ({ label })),
                ctaLabel: "Open session with Serene",
            };
        } catch (err) {
            logger.error(`generateSereneNudge failed for user ${uid}: ${err.message}`);
            return FALLBACK;
        }
    }
);
