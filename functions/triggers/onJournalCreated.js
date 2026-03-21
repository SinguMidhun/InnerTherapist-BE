const { generateEmbedding, generatePointId, upsertPoint } = require("../utils/vectorUtils");

function buildJournalText(data) {
    const parts = [];
    if (data.text || data.content) parts.push(data.text || data.content);
    if (data.emotions?.length) parts.push(`Emotions: ${data.emotions.join(", ")}`);
    if (data.contexts?.length) parts.push(`Contexts: ${data.contexts.join(", ")}`);
    if (data.bodyZones?.length) parts.push(`Body zones: ${data.bodyZones.join(", ")}`);
    if (data.intensityLevel != null) parts.push(`Intensity: ${data.intensityLevel}`);
    return parts.join("\n");
}

async function handleJournalCreated(uid, entryId, data, text, geminiKey) {
    const vector = await generateEmbedding(text, geminiKey);
    const id = generatePointId(uid, "journal", entryId);
    await upsertPoint(id, vector, {
        uid,
        type: "journal",
        source_id: entryId,
        text,
        emotions: data.emotions || [],
        contexts: data.contexts || [],
        body_zones: data.bodyZones || [],
        intensity: data.intensityLevel || 0,
        date: data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
    });
}

module.exports = { buildJournalText, handleJournalCreated };
