const { generateEmbedding, generatePointId, upsertPoint } = require("../utils/vectorUtils");

function buildMotivationReflectionText(data) {
    const parts = ["Morning motivation reflection."];
    if (data.energyShift != null) parts.push(`Energy shift: ${data.energyShift}.`);
    if (data.helpfulness) parts.push(`Helpfulness: ${data.helpfulness}.`);
    if (data.takeaways?.length) parts.push(`Takeaways: ${data.takeaways.join(", ")}.`);
    return parts.join(" ");
}

async function handleMotivationReflectionCreated(uid, dateKey, data, geminiKey) {
    const text = buildMotivationReflectionText(data);
    const vector = await generateEmbedding(text, geminiKey);
    const id = generatePointId(uid, "morning_motivation", dateKey);
    await upsertPoint(id, vector, {
        uid,
        type: "morning_motivation",
        source_id: dateKey,
        text,
        energy_shift: data.energyShift ?? null,
        helpfulness: data.helpfulness ?? null,
        takeaways: data.takeaways || [],
        date: data.createdAt?.toDate?.()?.toISOString() ?? `${dateKey}T00:00:00Z`,
    });
}

module.exports = { buildMotivationReflectionText, handleMotivationReflectionCreated };
