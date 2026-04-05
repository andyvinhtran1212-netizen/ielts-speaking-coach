import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob as GenAI_Blob } from '@google/genai';
import type { RecordedAnswer } from '../types';
import { decode, encode, decodeAudioData } from '../utils/audio';

interface LiveTestViewProps {
  part2Topic: string;
  onTestComplete: (recordedAnswers: RecordedAnswer[], durationInSeconds: number) => void;
  onEndTest: () => void;
}

const getSystemInstruction = (part2Topic: string) => `You are an expert, friendly, and patient IELTS examiner conducting a live, adaptive speaking test. Your speech should be clear and at a moderate pace.

The test has three parts. You will manage the transitions.

**Part 1: Introduction and Interview**
- Start with a friendly greeting and introduction, for example: "Hello, my name is Alex and I'll be your examiner today. Can you please tell me your full name?"
- After the name, say "Great. Now, in this first part, I'd like to ask you some questions about yourself."
- Then, pick ONE common topic like 'hometown', 'work', 'studies', or 'hobbies'. Announce the topic by saying "Let's talk about [your chosen topic]." on a new line.
- Ask 3-4 simple, one-part questions on this topic.
- After the last question, you MUST say on a new line: "---PART 1 END---"

**Part 2: Individual Long Turn**
- Introduce the part: "Now, I'm going to give you a topic and I'd like you to talk about it for one to two minutes."
- The student's chosen topic is: "${part2Topic}". Create a cue card for this.
- Announce the cue card and the 1-minute preparation time. You MUST say on a new line: "---PART 2 PREP START---"
- After exactly one minute, announce the start of the speaking time. You MUST say on a new line: "---PART 2 SPEAKING START---"
- After two minutes of the student speaking, politely stop them with "Thank you." You MUST then say on a new line: "---PART 2 END---"

**Part 3: Two-way Discussion**
- Introduce the part: "We've been talking about [Part 2 Topic] and I'd like to discuss with you one or two more general questions related to this."
- Then you MUST say on a new line: "---PART 3 START---"
- Ask 4-5 follow-up questions related to the Part 2 topic.
- After the final question, conclude the test by saying "That is the end of the speaking test. Thank you and goodbye." Then, you MUST say on a new line: "---TEST END---"

**CRITICAL RULES:**
- Wait for the user to finish speaking before you ask the next question.
- Adhere strictly to the timings for Part 2.
- YOU MUST output the specified markers on new lines to control the test flow.`;

// This AudioWorklet processor runs in a separate thread, receiving microphone audio
// and posting it back to the main thread in chunks. This prevents UI blocking.
const audioWorkletCode = `
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const inputChannel = input[0];

    if (inputChannel) {
      for (let i = 0; i < inputChannel.length; i++) {
        // Convert the audio from Float32 to Int16
        this.buffer[this.bufferIndex++] = inputChannel[i] * 32767;

        // When the buffer is full, send it to the main thread
        if (this.bufferIndex === this.bufferSize) {
          this.port.postMessage(this.buffer);
          this.bufferIndex = 0;
        }
      }
    }
    // Return true to keep the processor alive
    return true; 
  }
}

registerProcessor('audio-processor', AudioProcessor);
`;

export const LiveTestView: React.FC<LiveTestViewProps> = ({ part2Topic, onTestComplete, onEndTest }) => {
    const [status, setStatus] = useState('connecting'); // connecting, active, finished, error
    const [conversation, setConversation] = useState<{ speaker: 'examiner' | 'user', text: string }[]>([]);
    const [currentPart, setCurrentPart] = useState('Part 1');
    const [timer, setTimer] = useState(0);

    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
    const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
    const nextStartTimeRef = useRef(0);
    const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startTimeRef = useRef<number>(0);
    useEffect(() => {
        startTimeRef.current = Date.now();
    }, []);
    const finalAnswersRef = useRef<RecordedAnswer[]>([]);
    
    const processAndEndTest = useCallback(() => {
        if (status === 'finished') return;
        setStatus('finished');
        const duration = Math.round((Date.now() - startTimeRef.current) / 1000);
        onTestComplete(finalAnswersRef.current, duration);
    }, [onTestComplete, status]);

    useEffect(() => {
        const startSession = async () => {
            try {
                // Initialize separate audio contexts for input (mic) and output (AI speech)
                // This is crucial for handling different sample rates required by the browser and the API.
                inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                
                // If the browser suspends the audio context, resume it.
                if (inputAudioContextRef.current.state === 'suspended') await inputAudioContextRef.current.resume();
                if (outputAudioContextRef.current.state === 'suspended') await outputAudioContextRef.current.resume();
            } catch (e) {
                console.error("Failed to create audio contexts:", e);
                setStatus('error');
                return;
            }
            
            let currentInput = '';
            let currentOutput = '';
            let currentTopic = 'General';

            const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
            const ai = new GoogleGenAI({ apiKey: apiKey || 'dummy-key-to-prevent-crash' });
            
            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: async () => {
                        try {
                            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                            micStreamRef.current = stream;

                            const inputCtx = inputAudioContextRef.current!;

                            // Create the AudioWorklet
                            const blob = new Blob([audioWorkletCode], { type: 'application/javascript' });
                            const workletURL = URL.createObjectURL(blob);
                            await inputCtx.audioWorklet.addModule(workletURL);
                            
                            const workletNode = new AudioWorkletNode(inputCtx, 'audio-processor');
                            audioWorkletNodeRef.current = workletNode;
                            
                            // Listen for processed audio chunks from the worklet
                            workletNode.port.onmessage = (event) => {
                                const pcmBlob: GenAI_Blob = {
                                    data: encode(new Uint8Array(event.data.buffer)),
                                    mimeType: 'audio/pcm;rate=16000',
                                };
                                // Send the audio data to the Gemini API
                                sessionPromiseRef.current?.then(session => session.sendRealtimeInput({ media: pcmBlob }));
                            };

                            // Connect the microphone stream to the worklet
                            const source = inputCtx.createMediaStreamSource(stream);
                            micSourceNodeRef.current = source;
                            source.connect(workletNode);
                            // It's not necessary to connect the worklet to the destination if we don't want to hear the mic input.

                            setStatus('active');
                        } catch (err) {
                            console.error("Microphone or audio processing error:", err);
                            setStatus('error');
                        }
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            currentInput += message.serverContent.inputTranscription.text;
                        }
                        if (message.serverContent?.outputTranscription) {
                            currentOutput += message.serverContent.outputTranscription.text;
                        }

                        if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
                            const audioData = message.serverContent.modelTurn.parts[0].inlineData.data;
                            const ctx = outputAudioContextRef.current!;
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                            const audioBuffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
                            const source = ctx.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(ctx.destination);
                            source.addEventListener('ended', () => sourcesRef.current.delete(source));
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            sourcesRef.current.add(source);
                        }

                        if (message.serverContent?.turnComplete) {
                            const trimmedOutput = currentOutput.trim();
                            if (trimmedOutput) {
                                setConversation(prev => [...prev, { speaker: 'examiner', text: trimmedOutput }]);

                                // State machine based on markers from the AI
                                if (trimmedOutput.includes('---PART 1 END---')) setCurrentPart('Part 2 Prep');
                                if (trimmedOutput.includes('---PART 2 PREP START---')) {
                                    setCurrentPart('Part 2 Prep');
                                    if(timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                                    const duration = 60;
                                    setTimer(duration);
                                    const endTime = Date.now() + duration * 1000;
                                    timerIntervalRef.current = setInterval(() => {
                                        setTimer(Math.max(0, Math.round((endTime - Date.now()) / 1000)));
                                    }, 250);
                                }
                                if (trimmedOutput.includes('---PART 2 SPEAKING START---')) {
                                    if(timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                                    setCurrentPart('Part 2 Speaking');
                                    const duration = 120;
                                    setTimer(duration);
                                    const endTime = Date.now() + duration * 1000;
                                    timerIntervalRef.current = setInterval(() => {
                                        setTimer(Math.max(0, Math.round((endTime - Date.now()) / 1000)));
                                    }, 250);
                                }
                                if (trimmedOutput.includes('---PART 2 END---')) {
                                     if(timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                                     setTimer(0);
                                     setCurrentPart('Part 3');
                                }
                                if (trimmedOutput.includes('---PART 3 START---')) setCurrentPart('Part 3');
                                if (trimmedOutput.includes('---TEST END---')) {
                                    sessionPromiseRef.current?.then(session => session.close());
                                }
                                
                                const topicMatch = trimmedOutput.match(/Let's talk about (['"]?)(.*?)\1(?:[.]|$)/i);
                                if (topicMatch && topicMatch[2]) currentTopic = topicMatch[2];
                            }
                             const trimmedInput = currentInput.trim();
                            if (trimmedInput) {
                                setConversation(prev => [...prev, { speaker: 'user', text: trimmedInput }]);
                                finalAnswersRef.current.push({ part: currentPart, topic: currentTopic, question: trimmedOutput.split('\n').filter(line => !line.startsWith('---')).join('\n'), transcript: trimmedInput, audioBlob: new Blob() });
                            }
                            currentInput = '';
                            currentOutput = '';
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        setStatus('error');
                    },
                    onclose: () => {
                        processAndEndTest();
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    systemInstruction: getSystemInstruction(part2Topic),
                }
            });
            sessionPromiseRef.current = sessionPromise;
        };

        startSession();

        return () => {
            // Comprehensive cleanup of all resources
            sessionPromiseRef.current?.then(session => session.close());
            
            micSourceNodeRef.current?.disconnect();
            micSourceNodeRef.current = null;
            audioWorkletNodeRef.current?.port.close();
            audioWorkletNodeRef.current?.disconnect();
            audioWorkletNodeRef.current = null;

            micStreamRef.current?.getTracks().forEach(track => track.stop());
            micStreamRef.current = null;

            if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
                inputAudioContextRef.current.close();
            }
            if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
                outputAudioContextRef.current.close();
            }

            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        };
    }, [part2Topic, processAndEndTest, currentPart]);

    const renderStatus = () => {
        switch (status) {
            case 'connecting': return "Connecting to AI Examiner...";
            case 'active': return `Live Test in Progress: ${currentPart}`;
            case 'finished': return "Test Finished. Analyzing results...";
            case 'error': return "Connection Error. Please try again.";
            default: return "Live IELTS Test";
        }
    };
    
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-brand-light p-4">
            <div className="w-full max-w-3xl bg-gray-50 p-6 rounded-2xl shadow-xl min-h-[36rem] flex flex-col">
                <div className="flex justify-between items-center mb-4 border-b pb-3">
                    <h2 className="text-xl font-bold text-brand-dark">{renderStatus()}</h2>
                     {timer > 0 && <span className="text-2xl font-bold text-red-600">{`${Math.floor(timer/60)}:${(timer%60).toString().padStart(2,'0')}`}</span>}
                    <button onClick={onEndTest} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white rounded-lg border hover:bg-gray-100">End Test</button>
                </div>
                <div className="flex-grow bg-white rounded-lg p-4 overflow-y-auto space-y-4">
                    {conversation.map((entry, index) => (
                        <div key={index} className={`flex ${entry.speaker === 'examiner' ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[80%] p-3 rounded-xl ${entry.speaker === 'examiner' ? 'bg-gray-200 text-gray-800' : 'bg-brand-primary text-white'}`}>
                                <p className="font-bold capitalize text-sm mb-1">{entry.speaker}</p>
                                <p className="whitespace-pre-wrap">{entry.text}</p>
                            </div>
                        </div>
                    ))}
                    {status === 'connecting' && <div className="flex justify-center items-center p-4"><svg className="animate-spin h-6 w-6 text-brand-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span className="ml-3 text-gray-600">Please wait while we connect you...</span></div>}
                    {status === 'error' && <p className="text-center text-red-500 font-semibold p-4">A connection error occurred. Please end the test and try again.</p>}
                </div>
            </div>
        </div>
    );
};