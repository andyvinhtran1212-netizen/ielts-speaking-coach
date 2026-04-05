
import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { AnalysisResult, TestEvaluationResult } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Transcribes audio with intelligent prediction.
 * It is allowed to use context to guess unclear words but strictly forbidden from inventing new content.
 */
export const transcribeAudio = async (audioBase64: string, audioMimeType: string): Promise<string> => {
    const prompt = `You are an intelligent audio transcription assistant. 
    TASK: Transcribe the provided audio into text as accurately as possible.
    RULES:
    - SMART PREDICTION: You are encouraged to use linguistic context to predict or guess words that might be slightly unclear or mumbled, ensuring the transcript flows logically.
    - NO INVENTION: DO NOT add any sentences, facts, or ideas that were NOT present in the recording.
    - VERBATIM BUT COHERENT: Keep the speaker's original words, but use your intelligence to resolve ambiguities.
    - NO PARAPHRASING: Do not summarize or rewrite the content.
    - If the audio is only noise or silence, return exactly: "[No speech detected]"
    - NO introductory or concluding remarks. Just the text transcript.`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: { parts: [{ inlineData: { data: audioBase64, mimeType: audioMimeType } }, { text: prompt }] },
        });
        const text = response.text?.trim() || "";
        return text || "[No speech detected]";
    } catch (error) {
        console.error("Error transcribing audio:", error);
        throw new Error("Failed to transcribe audio.");
    }
};

/**
 * Generates high-quality speech using Gemini TTS.
 */
export const generateSpeech = async (text: string, voice: string = 'Kore'): Promise<string> => {
    if (!text || text.trim().length === 0) {
        throw new Error("No text provided for speech generation.");
    }

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voice },
                    },
                },
            },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) throw new Error("Audio generation returned empty data.");
        return base64Audio;
    } catch (error) {
        console.error("Error generating speech:", error);
        throw new Error("Failed to generate speech.");
    }
};

const keyMetricsSchema = {
    type: Type.OBJECT,
    properties: {
        grammarSuggestionsCount: { type: Type.INTEGER },
        relevanceRating: { type: Type.STRING },
        clarityRating: { type: Type.STRING },
        overallScore: { type: Type.NUMBER, description: "A score from 0 to 100 evaluating the student's overall performance (grammar, vocabulary, relevance)." }
    },
    required: ["grammarSuggestionsCount", "overallScore"]
};

const standardAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        keyMetrics: keyMetricsSchema,
        feedback: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    original: { type: Type.STRING },
                    correction: { type: Type.STRING },
                    explanation_vi: { type: Type.STRING }
                },
                 required: ["original", "correction", "explanation_vi"]
            }
        },
        improvedScript: { type: Type.STRING },
        answerExpansion: {
            type: Type.OBJECT,
            properties: {
                suggestions_vi: { type: Type.STRING },
                sample_extended_answer: { type: Type.STRING }
            },
            required: ["suggestions_vi", "sample_extended_answer"]
        }
    },
    required: ["keyMetrics", "feedback", "improvedScript"]
};

const advancedAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        keyMetrics: { ...keyMetricsSchema, required: ["grammarSuggestionsCount", "relevanceRating", "clarityRating", "overallScore"] },
        feedback: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    original: { type: Type.STRING },
                    correction: { type: Type.STRING },
                    explanation_vi: { type: Type.STRING }
                },
                 required: ["original", "correction", "explanation_vi"]
            }
        },
         relevanceFeedback: {
            type: Type.OBJECT,
            properties: { explanation_vi: { type: Type.STRING } },
            required: ["explanation_vi"]
        },
        clarityConcisenessFeedback: {
            type: Type.OBJECT,
            properties: {
                clarity_vi: { type: Type.STRING },
                conciseness_vi: { type: Type.STRING }
            },
            required: ["clarity_vi", "conciseness_vi"]
        },
        improvedScript: { type: Type.STRING }
    },
    required: ["keyMetrics", "feedback", "relevanceFeedback", "clarityConcisenessFeedback", "improvedScript"]
};

export const analyzeScript = async (script: string, question: string, analysisType: 'standard' | 'advanced'): Promise<AnalysisResult> => {
    const baseInstruction = "You are an expert English teacher specializing in IELTS. Your goal is to improve the student's script WITHOUT adding new information.";
    
    const prompt = `
    ${baseInstruction}
    Question: "${question}"
    Student's Script: "${script}"
    
    STRICT IMPROVEMENT RULES:
    1. The "improvedScript" MUST contain only the student's original ideas. 
    2. DO NOT add new sentences, new facts, or extra details that weren't in the original.
    3. ONLY correct grammar, improve vocabulary choices, and refine phrasing to sound natural.
    4. Provide feedback in Vietnamese (explanation_vi).
    5. Evaluate the student's overall performance and provide an "overallScore" from 0 to 100.
    6. Result must be valid JSON following the schema.`;

    const schema = analysisType === 'advanced' ? advancedAnalysisSchema : standardAnalysisSchema;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: schema },
        });
        return JSON.parse(response.text.trim()) as AnalysisResult;
    } catch (error) {
        console.error("Error analyzing script:", error);
        throw new Error("Failed to get analysis.");
    }
};

export const getTestEvaluation = async (
    audioBase64: string, audioMimeType: string, question: string, evaluationType: 'standard' | 'advanced'
): Promise<TestEvaluationResult> => {
    const prompt = `Perform a strict, realistic, and highly critical IELTS Speaking evaluation based on the provided audio.
    1. TRANSCRIBE: Output exactly what the student says. Do not fix any grammatical or vocabulary errors here. Include filler words (um, uh).
    2. EVALUATE: Provide an overall score on a scale of 0 to 100. This score MUST accurately reflect the official IELTS Speaking band descriptors.
       - CRITICAL SCORING INSTRUCTION: AI models tend to be overly generous. You MUST actively counteract this bias. Be extremely strict. Deduct points for EVERY single error, hesitation, or unnatural phrasing.
       - Calculate the score by evaluating the 4 IELTS criteria (Fluency, Lexical Resource, Grammar, Pronunciation) equally.
       - Score Mapping (Strictly Enforced):
         * 95-100 (Band 9.0): Flawless, native-like.
         * 90-94 (Band 8.5): Near-native, very rare errors.
         * 85-89 (Band 8.0): Very good, only occasional non-systematic errors.
         * 80-84 (Band 7.5): Good, handles complex language well.
         * 75-79 (Band 7.0): Good, some hesitation or grammar mistakes.
         * 70-74 (Band 6.5): Above average, generally clear but with noticeable errors.
         * 65-69 (Band 6.0): Average, willing to speak at length but may lose coherence.
         * 60-64 (Band 5.5): Average, noticeable hesitation, adequate vocabulary.
         * 55-59 (Band 5.0): Below average, maintains flow but with effort.
         * 50-54 (Band 4.5): Limited, frequent pauses, basic vocabulary.
         * 45-49 (Band 4.0): Very limited, struggles to maintain speech.
         * 0-44 (Band 3.5 and below): Poor, extremely difficult to understand.
       - PENALTY FOR SHORT ANSWERS: If the audio is very short (e.g., under 10 seconds) or only contains a few words, the score MUST be below 40, regardless of pronunciation quality, because it fails to demonstrate fluency and lexical resource.
       - EXPECTATION: Most non-native learners will score between 55 and 70. A score above 80 should be EXTREMELY rare and only given for truly exceptional, flawless performance.
    3. FEEDBACK: Provide detailed, critical feedback for each of the 4 IELTS criteria in Vietnamese. Explicitly list the mistakes made. Do not just give praise.
    4. IMPROVED SCRIPT: Refine the student's spoken words for better grammar, vocabulary, and flow.
       - CRITICAL: DO NOT add ANY new information, facts, or ideas. Only improve the expression of the student's original thoughts.
    Topic: "${question}"`;

    const testEvaluationSchema = {
        type: Type.OBJECT,
        properties: {
            overallScore: { type: Type.NUMBER, description: "A score from 0 to 100 based on IELTS criteria mapping (e.g., Band 7.0 = 78, Band 8.0 = 89, Band 9.0 = 100)." },
            ieltsCriteriaFeedback: {
                type: Type.OBJECT,
                properties: {
                    fluency_vi: { type: Type.STRING },
                    lexicalResource_vi: { type: Type.STRING },
                    grammaticalRangeAndAccuracy_vi: { type: Type.STRING },
                    pronunciation_vi: { type: Type.STRING },
                },
                required: ["fluency_vi", "lexicalResource_vi", "grammaticalRangeAndAccuracy_vi", "pronunciation_vi"]
            },
            summary_vi: { type: Type.STRING },
            suggestions_vi: { type: Type.STRING },
            transcribedScript: { type: Type.STRING },
            improvedScript: { type: Type.STRING }
        },
        required: ["overallScore", "ieltsCriteriaFeedback", "summary_vi", "suggestions_vi", "transcribedScript", "improvedScript"]
    };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: { parts: [{ inlineData: { data: audioBase64, mimeType: audioMimeType } }, { text: prompt }] },
            config: { responseMimeType: "application/json", responseSchema: testEvaluationSchema },
        });
        return JSON.parse(response.text.trim()) as TestEvaluationResult;
    } catch (error) {
        console.error("Error getting test evaluation:", error);
        throw new Error("Failed to get test evaluation.");
    }
};

