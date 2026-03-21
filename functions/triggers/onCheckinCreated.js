const { generateEmbedding, generatePointId, upsertPoint } = require("../utils/vectorUtils");

function buildCheckinText(data, dateKey) {
    const parts = [`Daily check-in for ${dateKey}.`];
    if (data.moodLevel != null) parts.push(`Mood level: ${data.moodLevel}.`);
    if (data.energyLevel != null) parts.push(`Energy level: ${data.energyLevel}.`);
    if (data.selectedBodySensations?.length) parts.push(`Body sensations: ${data.selectedBodySensations.join(", ")}.`);
    if (data.selectedContexts?.length) parts.push(`Contexts: ${data.selectedContexts.join(", ")}.`);
    return parts.join(" ");
}

async function handleCheckinCreated(uid, dateKey, data, geminiKey) {
    const text = buildCheckinText(data, dateKey);
    const vector = await generateEmbedding(text, geminiKey);
    const id = generatePointId(uid, "daily_checkin", dateKey);
    await upsertPoint(id, vector, {
        uid,
        type: "daily_checkin",
        source_id: dateKey,
        text,
        mood_level: data.moodLevel ?? null,
        energy_level: data.energyLevel ?? null,
        body_sensations: data.selectedBodySensations || [],
        contexts: data.selectedContexts || [],
        date: data.createdAt?.toDate?.()?.toISOString() ?? `${dateKey}T00:00:00Z`,
    });
}

module.exports = { buildCheckinText, handleCheckinCreated };
