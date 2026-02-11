const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI;
let model;

const initGemini = () => {
    if (!process.env.GEMINI_API_KEY) {
        console.warn('⚠️ GEMINI_API_KEY is missing. AI features will be disabled.');
        return;
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: 'gemini-pro' });
};

// Ensure initialized
const getModel = () => {
    if (!model) initGemini();
    if (!model) throw new Error('Gemini API not configured');
    return model;
};

const summarizeEmail = async (content) => {
    try {
        const model = getModel();
        const prompt = `Summarize the following email in 2-3 concise sentences. Focus on the main action items or key information.\n\nEmail Content:\n${content}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error('Gemini Summarize Error:', error);
        throw new Error('Failed to summarize email.');
    }
};

const generateSmartReplies = async (content) => {
    try {
        const model = getModel();
        const prompt = `Based on the email below, suggest 3 short, professional, and relevant replies. Return them as a JSON array of strings (e.g. ["Yes, I availabel", "Can we reschedule?"]). Do not include any markdown formatting, just the raw JSON array.\n\nEmail Content:\n${content}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Clean up markdown if present (```json ... ```)
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

        return JSON.parse(cleanText);
    } catch (error) {
        console.error('Gemini Smart Reply Error:', error);
        return ["Sounds good!", "I'll get back to you.", "received, thanks."]; // Fallback
    }
};

const helpMeWrite = async (userPrompt) => {
    try {
        const model = getModel();
        const prompt = `Write a professional email based on this request: "${userPrompt}". Keep it concise and polite. Just return the email body text.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error('Gemini Help Me Write Error:', error);
        throw new Error('Failed to generate draft.');
    }
};

module.exports = {
    summarizeEmail,
    generateSmartReplies,
    helpMeWrite
};
