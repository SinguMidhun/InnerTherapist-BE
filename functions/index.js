require("dotenv").config();

const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { getFirestore } = require("firebase-admin/firestore");
const { initializeApp } = require("firebase-admin/app");
const axios = require("axios");

initializeApp();
const db = getFirestore();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

setGlobalOptions({ maxInstances: 10 });

async function analyseJournalWithGemini(journalText) {
    const prompt = `You are a compassionate and insightful therapist. A user has written the following journal entry. Please:
1. Provide a brief emotional summary of how the user seems to be feeling.
2. Identify key themes or patterns in their writing.
3. Suggest 2-3 actionable steps or coping strategies they could try.

Journal Entry:
"${journalText}"

Respond in JSON format with the following structure:
{
  "emotionalSummary": "...",
  "themes": ["...", "..."],
  "actionItems": ["...", "...", "..."]
}`;

    const response = await axios.post(GEMINI_API_URL, {
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

exports.helloWorld = onRequest((request, response) => {
    logger.info("Hello logs!", { structuredData: true });
    response.send("Hello from Midhun Singu!");
});

exports.onJournalCreated = onDocumentCreated(
    "Users/{uid}/journal/{journalId}",
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
            const aiAnalysis = await analyseJournalWithGemini(journalText);
            logger.info("Gemini analysis received", { aiAnalysis });

            await db
                .collection("Users")
                .doc(uid)
                .collection("journal")
                .doc(journalId)
                .update({
                    aiAnalysis: aiAnalysis,
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
