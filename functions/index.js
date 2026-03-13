require("dotenv").config();

const { onRequest } = require("firebase-functions/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { getFirestore } = require("firebase-admin/firestore");
const { initializeApp } = require("firebase-admin/app");
const axios = require("axios");

initializeApp();
const db = getFirestore();

// Define secret for production
const geminiApiKey = defineSecret("GEMINI_API_KEY");

const getGeminiUrl = () => {
    // Falls back to .env variable for local development
    const key = process.env.GEMINI_SECRET || geminiApiKey.value();
    return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
};

async function analyseJournalWithGemini(journalText) {
    const prompt = `You are a compassionate and insightful therapist. A user has written the following journal entry. Please:
1. Provide a brief emotional summary and analysis of how the user seems to be feeling.
2. Suggest 2-3 actionable steps or coping strategies they could try.

Journal Entry:
"${journalText}"

Respond in JSON format with the following structure:
{
  "aiResponse": "...",
  "actionItems": ["...", "...", "..."]
}`;

    const response = await axios.post(getGeminiUrl(), {
        contents: [
            {
                parts: [{ text: prompt }],
            },
        ],
        generationConfig: {
            responseMimeType: "application/json",
        },
    });

    const aiText = response.data.candidates[0].content.parts[0].text;
    return JSON.parse(aiText);
}

exports.onJournalCreated = onDocumentCreated(
    {
        document: "Users/{uid}/journal/{journalId}",
        secrets: [geminiApiKey],
    },
    async (event) => {
        const snapshot = event.data;
        if (!snapshot) {
            logger.warn("No data associated with the event");
            return null;
        }

        const uid = event.params.uid;
        const journalId = event.params.journalId;
        const journalData = snapshot.data();
        const journalText = journalData.text || journalData.content || JSON.stringify(journalData);

        logger.info(`New journal created for user: ${uid}, journalId: ${journalId}`);

        try {
            const aiResult = await analyseJournalWithGemini(journalText);
            logger.info("Gemini analysis received", { aiResult });

            await db
                .collection("Users")
                .doc(uid)
                .collection("journal")
                .doc(journalId)
                .update({
                    aiResponse: aiResult.aiResponse,
                    actionItems: aiResult.actionItems,
                    analysedAt: new Date(),
                });

            logger.info(`AI analysis saved for journal ${journalId} of user ${uid}`);
        } catch (error) {
            logger.error("Error calling Gemini API", {
                error: error.message,
                response: error.response?.data,
            });
        }

        return null;
    },
);
