import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PracticePart, PracticeQuestion } from '../types';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { transcribeAudio } from '../services/geminiService';
import { WaveformVisualizer } from './WaveformVisualizer';
import { CueCardDisplay } from './CueCardDisplay';

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
};

interface RecordingModalProps {
    question: PracticeQuestion;
    part: PracticePart;
    onSave: (blob: Blob, transcript: string) => void;
    onClose: () => void;
}

export const RecordingModal: React.FC<RecordingModalProps> = ({ question, part, onSave, onClose }) => {
    const { startRecording, stopRecording, mediaStream, isRecording } = useAudioRecorder();
    const [timer, setTimer] = useState(0);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isCancelledRef = useRef(false);

    const handleStop = useCallback(async () => {
        if (isTranscribing) return; // Prevent double execution
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
        }
        
        setIsTranscribing(true);
        const blob = await stopRecording();
        const transcript = blob.size > 0 ? await transcribeAudio(blob) : "";
        onSave(blob, transcript);
    }, [stopRecording, onSave, isTranscribing]);

    const handleStart = useCallback(async () => {
        try {
            if (part === PracticePart.Part2 && question.cueCard) {
                // No TTS for Part by Part mode
                if (isCancelledRef.current) return;
                const duration = 60;
                setTimer(duration); // Prep time
                const endTime = Date.now() + duration * 1000;
                timerIntervalRef.current = setInterval(() => {
                    setTimer(Math.max(0, Math.round((endTime - Date.now()) / 1000)));
                }, 250);
            } else {
                 if (!question.questionText) {
                    throw new Error("Text for this question is missing.");
                 }
                 
                 await new Promise(resolve => setTimeout(resolve, 2000));
                 if (isCancelledRef.current) return;

                 await startRecording();
                 if (isCancelledRef.current) return;
                 const duration = part === PracticePart.Part1 ? 40 : 90; // 40s for P1, 90s for P3
                 setTimer(duration);
                 const endTime = Date.now() + duration * 1000;
                 timerIntervalRef.current = setInterval(() => {
                     setTimer(Math.max(0, Math.round((endTime - Date.now()) / 1000)));
                 }, 250);
            }
        } catch (error) {
            if (isCancelledRef.current) return;
            console.error("Error in practice mode start:", error);
            alert("Could not start the question. This might be due to a microphone access issue. Please check your browser permissions. The recorder will now close.");
            onClose();
        }
    }, [question, part, startRecording, onClose]);

    useEffect(() => {
        const runTimerLogic = async () => {
            // Timer logic only runs when a timer is active (not at 0) and the interval is set
            if (timer > 0 || !timerIntervalRef.current) return;

            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
            
            const isPrepTimerFinished = part === PracticePart.Part2 && question.cueCard && !isRecording;
            
            if (isPrepTimerFinished) {
                try {
                    // No TTS for Part by Part mode
                    if (isCancelledRef.current) return;
                    await startRecording();
                    if (isCancelledRef.current) return;
                    const duration = 120;
                    setTimer(duration);
                    const endTime = Date.now() + duration * 1000;
                    timerIntervalRef.current = setInterval(() => {
                        setTimer(Math.max(0, Math.round((endTime - Date.now()) / 1000)));
                    }, 250);
                } catch (error) {
                    if (isCancelledRef.current) return;
                    console.error("Error starting Part 2 speaking", error);
                    alert("Could not start recording. The recording will now stop.");
                    await handleStop();
                }
            } else {
                // Speaking time is over for any part
                await handleStop();
            }
        };

        runTimerLogic();
    }, [timer, part, question.cueCard, isRecording, startRecording, handleStop]);
    
    useEffect(() => {
        isCancelledRef.current = false;
        const startTimer = setTimeout(() => {
            if (!isCancelledRef.current) {
                handleStart();
            }
        }, 100);
        return () => { 
            isCancelledRef.current = true;
            clearTimeout(startTimer);
            if (timerIntervalRef.current) {
                clearInterval(timerIntervalRef.current);
            }
            // Stop recording without saving if modal is closed prematurely
            stopRecording(); 
        }
    }, [handleStart, stopRecording]);

    const isPrepping = part === PracticePart.Part2 && question.cueCard && !isRecording && timer > 0 && !isTranscribing;
    const isSpeakingPhase = isRecording && !isTranscribing;

    return (
        <div className="fixed inset-0 bg-neutral-900/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 z-50 animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-8 sm:p-10 text-center relative border border-neutral-100 overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-brand-primary"></div>
                <button 
                    onClick={onClose} 
                    className="absolute top-5 right-5 w-10 h-10 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-all focus:outline-none focus:ring-2 focus:ring-brand-primary/50" 
                    disabled={isTranscribing}
                    aria-label="Close modal"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                
                {isTranscribing ? (
                     <div className="py-12 flex flex-col items-center justify-center">
                        <div className="relative w-20 h-20 mb-8">
                            <div className="absolute inset-0 border-4 border-brand-light rounded-full"></div>
                            <div className="absolute inset-0 border-4 border-brand-primary rounded-full border-t-transparent animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <svg className="w-8 h-8 text-brand-primary animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                            </div>
                        </div>
                        <h3 className="text-2xl font-display font-bold text-brand-dark mb-3">Processing your audio</h3>
                        <p className="text-neutral-500 font-medium">Generating an accurate transcript using AI.<br/>This may take a moment.</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center">
                        <div className="w-full mb-8">
                            {question.cueCard ? (
                                <CueCardDisplay 
                                    topic={question.cueCard.topic} 
                                    instruction={question.cueCard.instruction}
                                    points={question.cueCard.points}
                                    className="max-w-md mx-auto shadow-sm border border-neutral-100"
                                />
                            ) : (
                                <div className="bg-neutral-50 p-6 sm:p-8 rounded-2xl border border-neutral-100 w-full">
                                    <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-3 block">Question</span>
                                    <h2 className="text-xl sm:text-2xl font-display font-bold text-brand-dark leading-snug">{question.questionText}</h2>
                                </div>
                            )}
                        </div>

                        {isPrepping && 
                            <div className="my-6 flex flex-col items-center justify-center bg-amber-50/50 w-full py-8 rounded-2xl border border-amber-100">
                                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 text-amber-600 mb-4">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                </div>
                                <p className="text-sm font-bold text-amber-600 uppercase tracking-widest mb-2">Preparation Time</p>
                                <p className="text-6xl sm:text-7xl font-display font-bold text-brand-dark tabular-nums tracking-tight">{formatTime(timer)}</p>
                            </div>
                        }
                        
                        {isSpeakingPhase && (
                            <div className="my-6 flex flex-col items-center justify-center w-full">
                                <div className="bg-rose-50/50 w-full py-8 rounded-2xl border border-rose-100 mb-6 relative overflow-hidden">
                                    <div className="absolute top-4 right-4 flex items-center">
                                        <span className="relative flex h-3 w-3 mr-2">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                                        </span>
                                        <span className="text-xs font-bold text-rose-600 uppercase tracking-wider">Recording</span>
                                    </div>
                                    <p className="text-sm font-bold text-neutral-500 uppercase tracking-widest mb-2">Time Remaining</p>
                                    <p className="text-6xl sm:text-7xl font-display font-bold text-brand-dark tabular-nums tracking-tight">{formatTime(timer)}</p>
                                </div>
                                
                                <div className="w-full max-w-md h-24 bg-neutral-50 rounded-xl border border-neutral-100 flex items-center justify-center overflow-hidden">
                                    {mediaStream ? (
                                        <WaveformVisualizer mediaStream={mediaStream} />
                                    ) : (
                                        <div className="flex items-center text-neutral-400">
                                            <svg className="w-5 h-5 mr-2 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                                            <span className="text-sm font-medium">Waiting for audio...</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        
                        {isSpeakingPhase && (
                            <button 
                                onClick={handleStop} 
                                className="mt-8 px-10 py-4 text-base font-bold text-white bg-rose-600 rounded-xl hover:bg-rose-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center w-full sm:w-auto"
                            >
                                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" /></svg>
                                Stop Recording
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};