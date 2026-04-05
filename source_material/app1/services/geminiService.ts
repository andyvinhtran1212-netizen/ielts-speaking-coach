

import { GoogleGenAI, Type } from "@google/genai";
import type { Part2CueCard, Part3Topic, AnalysisResult, PartPracticeAnalysis, SpokenQuestion, IdeaBuilderResult } from '../types';
import { IELTS_BAND_DESCRIPTORS } from "../constants";

const getAI = () => {
  const key = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn("API_KEY environment variable not set. Using mock services.");
  }
  return new GoogleGenAI({ apiKey: key || 'dummy-key-to-prevent-crash' });
};

// Helper to safely parse JSON that might be wrapped in markdown
const parseGeminiJson = (text: string) => {
    const cleanedText = text.replace(/^```json\s*|```\s*$/g, '');
    return JSON.parse(cleanedText);
};

const generateMockAnalysis = async (transcript: string): Promise<AnalysisResult> => {
    await new Promise(resolve => setTimeout(resolve, 3000));
    return {
        overallBandScore: 7.5,
        fluency: { score: 7, feedback: "Đây là phản hồi mẫu. Bạn nói khá trôi chảy nhưng có một vài lần ngập ngừng khi thảo luận về các chủ đề không quen thuộc." },
        lexicalResource: { score: 8, feedback: "Mẫu: Sử dụng tuyệt vời các từ vựng ít phổ biến như 'picturesque' và 'serendipitous'." },
        grammar: { score: 7.5, feedback: "Mẫu: Sử dụng tốt các cấu trúc phức tạp, nhưng có một số lỗi nhỏ về thì của động từ đã được ghi nhận." },
        pronunciation: { score: 7.5, feedback: "Mẫu: Phát âm nhìn chung rõ ràng. Cần luyện tập về trọng âm của các từ đa âm tiết." },
        summary: "Tóm tắt mẫu: Nhìn chung, đây là một phần thể hiện tốt. Để cải thiện, hãy tập trung vào việc giảm ngập ngừng khi tìm kiếm từ vựng và kiểm tra lại việc sử dụng các động từ ở thì quá khứ.",
        goldenTip: "Mẹo vàng mẫu: Ghi âm lại câu trả lời của bạn và so sánh với câu trả lời mẫu. Chú ý đến những điểm khác biệt về ngữ điệu và tốc độ nói.",
        fullTranscript: transcript
    };
};

// --- New Functions for Two-Phase Test Generation ---

export const generateQuestionsForPart1Topic = async (topic: string): Promise<SpokenQuestion[]> => {
    if (!process.env.API_KEY && !process.env.GEMINI_API_KEY) return [{ text: `Mock P1 question about ${topic}?` }];
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Generate 3-4 simple, introductory IELTS Speaking Part 1 questions about the topic: "${topic}".`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { questions: { type: Type.ARRAY, items: { type: Type.STRING } } },
                    required: ["questions"]
                }
            }
        });
        const json = parseGeminiJson(response.text);
        return json.questions.map((q: string) => ({ text: q }));
    } catch (error) {
        console.error(`Failed to generate Part 1 questions for topic: ${topic}`, error);
        throw error;
    }
};

export const generateCueCardForPart2Topic = async (topic: string): Promise<Part2CueCard> => {
     if (!process.env.API_KEY && !process.env.GEMINI_API_KEY) return { topic, instruction: `Describe a ${topic}.`, points: ["point 1", "point 2"] };
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Create an IELTS Speaking Part 2 cue card for the topic "${topic}". The response must be a JSON object with a 'topic' (string), an 'instruction' (string, starting with "Describe..."), and 'points' (an array of 4-5 strings for the bullet points).`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        topic: { type: Type.STRING, description: "The topic of the cue card." },
                        instruction: { type: Type.STRING, description: "The main instruction, e.g., 'Describe a memorable holiday.'" },
                        points: { type: Type.ARRAY, items: { type: Type.STRING }, description: "An array of bullet points." }
                    },
                    required: ["topic", "instruction", "points"]
                }
            }
        });
        return parseGeminiJson(response.text);
    } catch (error) {
        console.error(`Failed to generate Part 2 cue card for topic: ${topic}`, error);
        throw error;
    }
};

export const generatePart3Topics = async (part2CueCard: Part2CueCard): Promise<Part3Topic[]> => {
    if (!process.env.API_KEY && !process.env.GEMINI_API_KEY) return [{ topic: `Follow-up on ${part2CueCard.topic}`, questions: [{ text: "Mock P3 question?" }] }];
     try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Given the IELTS Part 2 topic "${part2CueCard.topic}", generate 2 distinct topics for a Part 3 discussion. For each topic, create 3-4 questions. You are an AI assistant creating questions for an English learner at a Band 5.0 level. It is absolutely critical that the questions are simple, short, and ask only ONE thing.

Follow this strict, non-negotiable, two-step process FOR EVERY QUESTION:
**Step 1: Ideation.** Think of a simple idea.
**Step 2: Ruthless Simplification.** Convert the idea into ONE question that meets ALL of these rules:
- **RULE 1:** Must be under 15 words. This is a hard limit.
- **RULE 2:** Must ask only ONE thing. No "and", "or", or commas connecting ideas.
- **RULE 3:** Must NOT be a "discuss both views" type of question.
- **RULE 4:** Must NOT ask "Why?" or "Why not?" at the end of the question.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        part3Topics: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    topic: { type: Type.STRING },
                                    questions: { type: Type.ARRAY, items: { type: Type.STRING } }
                                },
                                required: ["topic", "questions"]
                            }
                        }
                    },
                    required: ["part3Topics"]
                }
            }
        });
        const json = parseGeminiJson(response.text);
        return json.part3Topics.map((topicSet: any) => ({
            topic: topicSet.topic,
            questions: topicSet.questions.map((qText: string): SpokenQuestion => ({ text: qText })),
        }));
    } catch (error) {
        console.error(`Failed to generate Part 3 topics for: ${part2CueCard.topic}`, error);
        throw error;
    }
}


// -------------------------------------------------------------------

const formatCriteriaForPrompt = () => {
    let criteriaString = "";
    for (const [criterion, bands] of Object.entries(IELTS_BAND_DESCRIPTORS)) {
        const formattedTitle = criterion.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
        criteriaString += `**${formattedTitle}**\n`;
        for (const [band, desc] of Object.entries(bands).reverse()) {
            criteriaString += `- Band ${band}: ${desc}\n`;
        }
        criteriaString += "\n";
    }
    return criteriaString;
};

export const analyzeSpeakingTest = async (transcript: string): Promise<AnalysisResult> => {
  if (!process.env.API_KEY && !process.env.GEMINI_API_KEY) return generateMockAnalysis(transcript);

  try {
    const ai = getAI();
    const criteriaText = formatCriteriaForPrompt();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: `You will adopt a dual persona for this task.

**Persona 1: The Strict Examiner (For Scoring):** When determining the numerical scores for each criterion and the overall band score, you must be a strict, impartial, and experienced IELTS examiner. Your scoring must be objective, precise, and based solely on the provided marking criteria. There is no room for leniency; the scores must reflect a real test environment.

**Persona 2: The Supportive Coach (For Feedback):** When writing all textual feedback (for each criterion, the summary, and the golden tip), you must switch to the persona of a supportive, sympathetic, and constructive speaking coach. Your language should be encouraging and empathetic. Acknowledge the student's effort and strengths first, then gently guide them through areas for improvement. Frame your advice as an actionable plan to help them succeed, not as a list of failures.

**Official Marking Criteria:**
${criteriaText}

**Transcript to Analyze (contains responses from Part 1, 2, and 3):**
---
${transcript}
---

**Instructions for Analysis and Scoring:**
1.  **Holistic Analysis:** Analyze the entire transcript as a whole, considering performance across all parts.
2.  **Accurate Scoring (Examiner Persona):** As the strict examiner, adhere strictly to the band descriptors to assign a precise band score from 0-9 (in 0.5 increments) for each of the four criteria. Performance in Part 3, which requires more complex language, should be weighted heavily.
3.  **Infer Pronunciation:** Carefully infer pronunciation issues from transcript evidence. Look for patterns of hesitation, self-correction, filler words (um, uh), and awkward phrasing that strongly suggest underlying pronunciation or intonation problems.
4.  **Overall Score Calculation (Examiner Persona):** As the examiner, calculate the overall band score by taking the mean of the four criteria scores. Round the result to the nearest half-band (e.g., an average of 6.25 becomes 6.5; 6.75 becomes 7.0; 6.1 becomes 6.0).
5.  **Actionable Feedback (Coach Persona):** As the supportive coach, provide specific, constructive feedback for EACH of the four criteria. Start by acknowledging a positive aspect before gently introducing areas for improvement. **You MUST quote specific examples of errors and strengths directly from the transcript to justify your score.**
6.  **Summary (Coach Persona):** Write a final 'summary' paragraph that identifies the 1-2 most critical areas for improvement. Frame this as a "Personalized Action Plan" in a coaching tone.
7.  **Golden Tip (Coach Persona):** Provide one single, highly actionable "goldenTip" with an encouraging and practical tone.
8.  **Language and Tone:** **CRITICAL: ALL FEEDBACK, the SUMMARY, and the GOLDEN TIP MUST be written in VIETNAMESE.** Remember to maintain the supportive and empathetic coaching tone throughout all written text, using simple language a learner can understand.
9.  **JSON Output:** Return the entire response in the specified JSON format. Ensure all fields are populated correctly.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallBandScore: { type: Type.NUMBER, description: "Overall band score from 0-9." },
            fluency: {
              type: Type.OBJECT,
              properties: { score: { type: Type.NUMBER }, feedback: { type: Type.STRING } },
              required: ["score", "feedback"]
            },
            lexicalResource: {
              type: Type.OBJECT,
              properties: { score: { type: Type.NUMBER }, feedback: { type: Type.STRING } },
               required: ["score", "feedback"]
            },
            grammar: {
              type: Type.OBJECT,
              properties: { score: { type: Type.NUMBER }, feedback: { type: Type.STRING } },
               required: ["score", "feedback"]
            },
            pronunciation: {
              type: Type.OBJECT,
              properties: { score: { type: Type.NUMBER }, feedback: { type: Type.STRING } },
               required: ["score", "feedback"]
            },
            summary: { type: Type.STRING, description: "A summary of personalized suggestions for improvement, written in Vietnamese." },
            goldenTip: { type: Type.STRING, description: "A single, actionable tip for the student, written in Vietnamese." },
            fullTranscript: {
                type: Type.STRING,
                description: "The full transcript that was analyzed."
            }
          },
          required: ["overallBandScore", "fluency", "lexicalResource", "grammar", "pronunciation", "summary", "goldenTip", "fullTranscript"]
        }
      }
    });
    
    const json = parseGeminiJson(response.text);
    if (!json.fullTranscript) {
        json.fullTranscript = transcript;
    }
    return json;
  } catch (error) {
    console.error("Error analyzing speaking test:", error);
    return generateMockAnalysis(transcript); // Fallback to mock on error
  }
};

interface PracticeSetResult {
    questions?: SpokenQuestion[];
    cueCard?: Part2CueCard;
}

export const generatePracticeSet = async (part: 'Part 1' | 'Part 2' | 'Part 3', topic: string): Promise<PracticeSetResult> => {
    if (!process.env.API_KEY && !process.env.GEMINI_API_KEY) {
        // Mock response for practice
        await new Promise(resolve => setTimeout(resolve, 500));
        if (part === 'Part 2') {
            return { cueCard: { topic: topic, instruction: `Describe ${topic}.`, points: ["what it is", "how you know it", "what you think about it", "and explain why it is important to you."] } };
        }
        return { questions: [{text: `This is mock question 1 about ${topic}.`}] };
    }

    try {
        if (part.toLowerCase() === 'part 2') {
            const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: `Create a single IELTS Speaking Part 2 cue card for the topic "${topic}". The response must be a single JSON object with a 'topic' (string), an 'instruction' (string, starting with "Describe..."), and 'points' (an array of 4-5 strings for the bullet points).`,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            topic: { type: Type.STRING, description: "The topic of the cue card." },
                            instruction: { type: Type.STRING, description: "The main instruction, e.g., 'Describe a memorable place.'" },
                            points: { type: Type.ARRAY, items: { type: Type.STRING }, description: "An array of 4-5 bullet points." }
                        },
                        required: ["topic", "instruction", "points"]
                    }
                }
            });
            const cueCard: Part2CueCard = parseGeminiJson(response.text);
            return { cueCard };
        } else { // Part 1 or Part 3
             const prompt = part === 'Part 3'
                ? `Generate 3-5 IELTS Speaking Part 3 practice questions about "${topic}". You are an AI assistant creating questions for an English learner at a Band 5.0 level. It is absolutely critical that the questions are simple, short, and ask only ONE thing.

Follow this strict, non-negotiable, two-step process FOR EVERY QUESTION:
**Step 1: Ideation.** Think of a simple idea.
**Step 2: Ruthless Simplification.** Convert the idea into ONE question that meets ALL of these rules:
- **RULE 1:** Must be under 15 words. This is a hard limit.
- **RULE 2:** Must ask only ONE thing. No "and", "or", or commas connecting ideas.
- **RULE 3:** Must NOT be a "discuss both views" type of question.
- **RULE 4:** Must NOT ask "Why?" or "Why not?" at the end of the question.

**The most important instruction: ONE THOUGHT = ONE QUESTION. SIMPLICITY IS KEY.**`
                : `Generate a set of 3-5 clear and accessible IELTS Speaking ${part} practice questions related to the topic: "${topic}".`;

             const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            questions: { 
                                type: Type.ARRAY, 
                                description: "An array of 3-5 practice questions.",
                                items: { type: Type.STRING }
                            }
                        },
                        required: ["questions"]
                    }
                }
            });
            const json = parseGeminiJson(response.text);
            const questions: SpokenQuestion[] = json.questions.map((text: string) => ({ text }));
            return { questions };
        }
    } catch (error) {
        console.error(`Error generating practice set for ${part}:`, error);
        if (part === 'Part 2') {
            return { cueCard: { topic: topic, instruction: `Error generating cue card for ${topic}.`, points: [] } };
        }
        return { questions: [{ text: `Error generating questions for ${topic}.` }] };
    }
};

export const generateFollowUpPart3Set = async (cueCard: Part2CueCard): Promise<{ topic: string; questions: SpokenQuestion[] }> => {
    const mockResponse = {
        topic: `Follow-up on ${cueCard.topic}`,
        questions: [
            { text: `This is a mock follow-up question about ${cueCard.topic}. What are your general thoughts?` },
            { text: `How has ${cueCard.topic} changed in recent years?` },
            { text: `What do you think the future of ${cueCard.topic} will be?` },
        ]
    };

    if (!process.env.API_KEY && !process.env.GEMINI_API_KEY) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return mockResponse;
    }

    try {
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Given the IELTS Part 2 topic "${cueCard.topic}", generate a single, relevant Part 3 topic and 3-4 discussion questions. You are an AI assistant creating questions for an English learner at a Band 5.0 level. It is absolutely critical that the questions are simple, short, and ask only ONE thing.

Follow this strict, non-negotiable, two-step process FOR EVERY QUESTION:
**Step 1: Ideation.** Think of a simple idea.
**Step 2: Ruthless Simplification.** Convert the idea into ONE question that meets ALL of these rules:
- **RULE 1:** Must be under 15 words. This is a hard limit.
- **RULE 2:** Must ask only ONE thing. No "and", "or", or commas connecting ideas.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        topic: { type: Type.STRING, description: "A short topic title for the Part 3 discussion." },
                        questions: {
                            type: Type.ARRAY,
                            description: "An array of 3-4 Part 3 discussion questions.",
                            items: { type: Type.STRING }
                        }
                    },
                    required: ["topic", "questions"]
                }
            }
        });
        const json = parseGeminiJson(response.text);
        const questions: SpokenQuestion[] = json.questions.map((text: string) => ({ text }));

        return { topic: json.topic, questions };
    } catch (error) {
        console.error("Error generating follow-up Part 3 set:", error);
        return mockResponse;
    }
};

// Helper function to convert Blob to base64
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result !== 'string') {
                return reject(new Error("Failed to read blob as a data URL."));
            }
            // result is in the format "data:[<mediatype>][;base64],<data>"
            // we only need the base64 part
            const base64Data = reader.result.split(',')[1];
            resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
    if ((!process.env.API_KEY && !process.env.GEMINI_API_KEY) || audioBlob.size === 0) {
        if (audioBlob.size === 0) return "";
        console.warn("API_KEY not set or audio blob is empty, returning mock transcription.");
        return Promise.resolve("This is a mock transcription of your audio response.");
    }

    try {
        const ai = getAI();
        const base64Audio = await blobToBase64(audioBlob);

        const audioPart = {
            inlineData: {
                mimeType: audioBlob.type, // e.g., 'audio/mp4'
                data: base64Audio,
            },
        };
        
        const textPart = {
            text: "Please provide an accurate, clean transcription of the following audio recording. The speaker is an English language learner participating in a practice test. Do not add any commentary, corrections, or explanatory text. Provide only the transcribed text."
        };

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [audioPart, textPart] },
        });

        return response.text.trim();
    } catch (error) {
        console.error("Error transcribing audio:", error);
        return "Sorry, there was an error transcribing your audio. The AI model may have had trouble processing the recording.";
    }
};

const partPracticeAnalysisSchema = {
    type: Type.OBJECT,
    properties: {
        highlightedTranscript: {
            type: Type.ARRAY,
            description: "The student's transcript, broken into chunks. Each chunk has a 'text' and an 'isMistake' boolean.",
            items: {
                type: Type.OBJECT,
                properties: {
                    text: { type: Type.STRING },
                    isMistake: { type: Type.BOOLEAN }
                },
                required: ["text", "isMistake"]
            }
        },
        corrections: {
            type: Type.ARRAY,
            description: "A list of specific corrections for mistakes, with explanations in Vietnamese.",
            items: {
                type: Type.OBJECT,
                properties: {
                    incorrectPhrase: { type: Type.STRING },
                    correction: { type: Type.STRING },
                    explanation: { type: Type.STRING, description: "Explanation in Vietnamese." },
                    category: { type: Type.STRING, description: "The type of mistake (e.g., 'Grammar', 'Vocabulary', 'Phrasing')." }
                },
                required: ["incorrectPhrase", "correction", "explanation", "category"]
            }
        },
        feedback: {
            type: Type.OBJECT,
            description: "Feedback in Vietnamese for the four IELTS criteria.",
            properties: {
                fluency: { type: Type.STRING, description: "Feedback on Fluency and Coherence in Vietnamese." },
                lexicalResource: { type: Type.STRING, description: "Feedback on Lexical Resource in Vietnamese." },
                grammar: { type: Type.STRING, description: "Feedback on Grammatical Range and Accuracy in Vietnamese." },
                pronunciation: { type: Type.STRING, description: "Feedback on Pronunciation in Vietnamese." }
            },
            required: ["fluency", "lexicalResource", "grammar", "pronunciation"]
        },
        sampleAnswer: { type: Type.STRING, description: "A natural, clear sample answer suitable for a Band 7 level." },
        overallBandScore: { type: Type.NUMBER, description: "Estimated band score for this specific answer, from 0-9 in 0.5 increments." }
    },
    required: ["highlightedTranscript", "corrections", "feedback", "sampleAnswer", "overallBandScore"]
};

export const generatePartPracticeAnalysis = async (question: string, transcript: string): Promise<PartPracticeAnalysis> => {
    if (!process.env.API_KEY && !process.env.GEMINI_API_KEY) {
        // Mock response
        await new Promise(resolve => setTimeout(resolve, 1500));
        return {
            overallBandScore: 6.5,
            highlightedTranscript: [
                { text: "Well, I think ", isMistake: false },
                { text: "the transports ", isMistake: true },
                { text: "in my city is quite convenient. We have buses and a new metro system.", isMistake: false }
            ],
            corrections: [{
                incorrectPhrase: "the transports",
                correction: "transport",
                explanation: "Danh từ 'transport' ở đây thường được dùng ở dạng không đếm được khi nói về hệ thống giao thông nói chung. Bạn có thể nói 'transport system' nếu muốn.",
                category: "Grammar"
            }],
            feedback: {
                fluency: "Điểm mạnh: Bạn trả lời khá trôi chảy, không ngập ngừng nhiều. Điểm yếu: Cần cố gắng sử dụng các từ nối để liên kết ý tưởng một cách mượt mà hơn.",
                lexicalResource: "Điểm mạnh: Sử dụng đúng từ 'convenient'. Điểm yếu: Vốn từ vựng còn khá cơ bản. Hãy thử dùng các từ như 'efficient', 'accessible' hay 'integrated'.",
                grammar: "Điểm mạnh: Sử dụng câu đơn chính xác. Điểm yếu: Mắc lỗi với danh từ đếm được/không đếm được (ví dụ: 'transports').",
                pronunciation: "Điểm mạnh: Phát âm từ 'convenient' rõ ràng. Điểm yếu: Ngữ điệu câu còn đều đều, chưa tự nhiên. Cần nhấn trọng âm câu để nghe hay hơn."
            },
            sampleAnswer: "In my city, the public transport system is fairly comprehensive. The most popular option is the bus network, which covers almost the entire city. Recently, a new metro line was introduced, and it has become incredibly popular because it's fast and efficient, especially for commuting to the city center."
        };
    }

    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents: `As an expert IELTS examiner, provide a detailed analysis of the student's single answer. Your goal is to give clear, actionable feedback in a structured JSON format.

**Instructions:**
1.  **Segment and Highlight:** Break down the student's answer into segments. For each segment, identify if it contains a mistake. Return this as a \`highlightedTranscript\` array.
2.  **Detailed Corrections:** For each mistake, create a correction object. This must include the \`incorrectPhrase\`, a \`correction\`, a simple \`explanation\`, and a \`category\`. **CRITICAL: All \`explanation\` text MUST be in VIETNAMESE.**
3.  **IELTS Criteria Feedback:** Provide feedback based on the four official IELTS marking criteria (Fluency and Coherence, Lexical Resource, Grammatical Range and Accuracy, Pronunciation). For each criterion, briefly state strengths and weaknesses. **CRITICAL: ALL this feedback MUST be in VIETNAMESE.**
4.  **Estimate Band Score:** Provide an estimated \`overallBandScore\` (from 0-9 in 0.5 increments) for THIS SINGLE ANSWER. Base this on the official IELTS band descriptors.
5.  **Upgraded Sample Answer:** Write a high-scoring (Band 7-8) sample answer to the original question. **CRUCIAL: This sample answer must be a better version of the student's own response.** It should incorporate the student's original ideas and main points but express them with better vocabulary, more complex grammar, and improved fluency. Do not introduce completely new ideas that the student did not mention. The goal is to show the student how *their* answer could be improved to reach a higher band score.

**Original Question:** "${question}"
**Student's Answer:** "${transcript}"`,
            config: {
                responseMimeType: "application/json",
                responseSchema: partPracticeAnalysisSchema
            }
        });
        const json = parseGeminiJson(response.text);
        return json;
    } catch (error) {
        console.error("Error generating part practice analysis:", error);
        return {
             highlightedTranscript: [{ text: "An error occurred during analysis.", isMistake: true }],
             corrections: [{
                incorrectPhrase: "N/A",
                correction: "N/A",
                explanation: "Đã có lỗi xảy ra khi phân tích. Vui lòng thử lại.",
                category: "Grammar",
             }],
             feedback: { 
                 fluency: "Lỗi phân tích.", 
                 lexicalResource: "Lỗi phân tích.", 
                 grammar: "Lỗi phân tích.", 
                 pronunciation: "Lỗi phân tích." 
             },
             sampleAnswer: "Could not generate a sample answer due to an error.",
             overallBandScore: 0
        };
    }
};

export const generateIdeaBuilderContent = async (topic: string): Promise<IdeaBuilderResult> => {
    if (!process.env.API_KEY && !process.env.GEMINI_API_KEY) {
        // Mock response
        await new Promise(resolve => setTimeout(resolve, 1500));
        return {
            topic: topic,
            mindMap: {
                mainIdeas: [
                    { idea: "Types of Holidays", subIdeas: ["Beach vacations", "City breaks", "Adventure travel"] },
                    { idea: "Holiday Activities", subIdeas: ["Sightseeing", "Relaxing", "Trying local food"] }
                ]
            },
            vocabulary: [
                { word: "Itinerary", definition: "A planned route or journey.", example: "We planned a detailed itinerary for our trip to Japan." },
                { word: "Breathtaking", definition: "Extremely beautiful or amazing.", example: "The view from the mountain top was breathtaking." }
            ],
            part1Questions: ["Do you like holidays?", "What was your last holiday?", "Who do you prefer to travel with?"],
            part2CueCard: {
                instruction: "Describe a holiday you really enjoyed.",
                points: ["Where you went", "Who you went with", "What you did", "and explain why you enjoyed it so much."]
            },
            part3Questions: ["Why do people need holidays?", "What are the benefits of travelling?", "How has tourism changed in your country?"]
        };
    }

    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `You are an expert IELTS coach. Your task is to help a student prepare for the topic: "${topic}". Generate a comprehensive preparation guide in a structured JSON format.

The guide must include:
1.  **mindMap**: A mind map of related ideas. This should have a list of 2-4 'mainIdeas', and each main idea should have a list of 2-3 'subIdeas'.
2.  **vocabulary**: A list of 5-7 key vocabulary items, including less common words and idioms relevant to the topic. For each item, provide the 'word', a simple 'definition', and an 'example' sentence.
3.  **part1Questions**: A list of 3-4 simple, introductory IELTS Speaking Part 1 questions.
4.  **part2CueCard**: A single IELTS Speaking Part 2 cue card, including an 'instruction' (e.g., 'Describe...') and a list of 'points'.
5.  **part3Questions**: A list of 3-4 more abstract, discussion-based IELTS Speaking Part 3 questions.

Ensure the entire output is a single, valid JSON object that conforms to the specified schema.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        topic: { type: Type.STRING },
                        mindMap: {
                            type: Type.OBJECT,
                            properties: {
                                mainIdeas: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            idea: { type: Type.STRING },
                                            subIdeas: { type: Type.ARRAY, items: { type: Type.STRING } }
                                        },
                                        required: ["idea", "subIdeas"]
                                    }
                                }
                            },
                            required: ["mainIdeas"]
                        },
                        vocabulary: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    word: { type: Type.STRING },
                                    definition: { type: Type.STRING },
                                    example: { type: Type.STRING }
                                },
                                required: ["word", "definition", "example"]
                            }
                        },
                        part1Questions: { type: Type.ARRAY, items: { type: Type.STRING } },
                        part2CueCard: {
                            type: Type.OBJECT,
                            properties: {
                                instruction: { type: Type.STRING },
                                points: { type: Type.ARRAY, items: { type: Type.STRING } }
                            },
                            required: ["instruction", "points"]
                        },
                        part3Questions: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["topic", "mindMap", "vocabulary", "part1Questions", "part2CueCard", "part3Questions"]
                }
            }
        });
        return parseGeminiJson(response.text);
    } catch (error) {
        console.error(`Error generating idea builder content for ${topic}:`, error);
        throw error;
    }
};