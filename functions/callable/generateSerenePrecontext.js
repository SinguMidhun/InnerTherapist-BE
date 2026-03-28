const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { getFirestore } = require("firebase-admin/firestore");
const { QdrantClient } = require("@qdrant/js-client-rest");
const { generateEmbedding } = require("../utils/vectorUtils");

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const qdrantApiKey = defineSecret("QDRANT_API_KEY");

const COLLECTION_NAME = "user_insights";

exports.generateSerenePrecontext = onCall(
    { secrets: [geminiApiKey, qdrantApiKey] },
    async (request) => {
        const uid = request.auth?.uid;
        if (!uid) {
            throw new HttpsError("unauthenticated", "Login required");
        }

        try {
            const db = getFirestore();

            const userDoc = await db.collection("Users").doc(uid).get();
            const onboarding = userDoc.data()?.onboarding || {};

            const profileLines = [
                "USER PROFILE:",
                `- Name: ${onboarding.name || "Unknown"}`,
                `- Age: ${onboarding.age || "Unknown"}`,
                `- What brought them here: ${(onboarding.bringsMeHere || []).join(", ") || "not specified"}`,
                `- Stress triggers: ${(onboarding.triggers || []).join(", ") || "not specified"}`,
                `- Coping strategies: ${(onboarding.copingStrategies || []).join(", ") || "not specified"}`,
                `- Life areas out of balance: ${(onboarding.lifeBalance || []).join(", ") || "not specified"}`,
                `- Improvement goal: ${onboarding.improvementGoal || "not specified"}`,
                `- Support style preference: ${onboarding.supportStyle || "not specified"}`,
            ];

            const geminiKey = process.env.GEMINI_SECRET || geminiApiKey.value();
            const sessionContext = request.data?.sessionContext;
            const queryText = sessionContext && sessionContext.trim()
                ? sessionContext
                : "The user's recent emotional state, concerns, mood patterns, and therapy progress.";

            const queryEmbedding = await generateEmbedding(queryText, geminiKey);

            const qdrant = new QdrantClient({
                url: process.env.QDRANT_URL,
                apiKey: process.env.LOCAL_QDRANT_API_KEY || qdrantApiKey.value(),
            });

            const mustFilters = [{ key: "uid", match: { value: uid } }];

            if (!sessionContext || !sessionContext.trim()) {
                const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
                mustFilters.push({ key: "date", range: { gte: cutoff } });
            }

            const queryResult = await qdrant.query(COLLECTION_NAME, {
                query: queryEmbedding,
                limit: 15,
                filter: { must: mustFilters },
                with_payload: true,
            });
            const results = queryResult.points || [];

            logger.info(`Precontext search for user ${uid}, found ${results.length} results`);

            const historyLines = ["", "RELEVANT HISTORY (from past sessions, journals, and check-ins):"];

            if (results.length === 0) {
                historyLines.push("No prior history available yet.");
            } else {
                results.forEach((r, i) => {
                    const p = r.payload;
                    const typeLabel = {
                        journal: "Journal",
                        daily_checkin: "Check-in",
                        serene_session: "Session",
                        morning_motivation: "Reflection",
                    }[p.type] || p.type;

                    const dateStr = p.date
                        ? new Date(p.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                        })
                        : "Unknown date";

                    historyLines.push(`${i + 1}. [${typeLabel}, ${dateStr}] ${p.text}`);
                });
            }

            const instructions = [
                "",
                "Use this context to inform your responses. Reference past entries naturally when relevant.",
                "Do not explicitly say \"according to your journal\" — instead weave the knowledge in organically.",
                "If the user seems to be revisiting a recurring theme, gently acknowledge it.",
            ];

            const precontext = [
                ...profileLines,
                ...historyLines,
                ...instructions,
            ].join("\n");

            return { precontext };
        } catch (err) {
            logger.error(`generateSerenePrecontext failed for user ${uid}: ${err.message}`);

            const db = getFirestore();
            const fallbackProfile = `USER PROFILE:\n- Name: ${(await db.collection("Users").doc(uid).get())
                    .data()?.onboarding?.name || "Unknown"
                }`;
            return { precontext: fallbackProfile };
        }
    }
);
