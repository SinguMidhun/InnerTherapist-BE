const { generateEmbedding, generatePointId, upsertPoint } = require("../utils/vectorUtils");

function buildSessionText(data) {
    const parts = [];
    if (data.summary) parts.push(`Session summary: ${data.summary}`);
    if (data.messageCount) parts.push(`Messages exchanged: ${data.messageCount}`);
    return parts.join("\n") || "Serene therapy session.";
}

async function handleSessionEnded(uid, sessionId, data, geminiKey) {
    const text = buildSessionText(data);
    const vector = await generateEmbedding(text, geminiKey);
    const id = generatePointId(uid, "serene_session", sessionId);
    await upsertPoint(id, vector, {
        uid,
        type: "serene_session",
        source_id: sessionId,
        text,
        message_count: data.messageCount || 0,
        date: data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
    });
}

module.exports = { buildSessionText, handleSessionEnded };
