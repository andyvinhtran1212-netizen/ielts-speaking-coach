
import React, { useState, useMemo, useCallback } from 'react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { getTestEvaluation } from '../services/geminiService';
import { blobToBase64, getFriendlyErrorMessage } from '../App';
import type { TestEvaluationResult } from '../types';
import Loader from './Loader';
import { MicIcon } from './icons/MicIcon';
import { StopIcon } from './icons/StopIcon';
import TestResultDisplay from './TestResultDisplay';
import SoundWave from './SoundWave';


interface TestModeProps {
  onSwitchToPractice: () => void;
}

type TestStage = 'selectingPart' | 'recording' | 'evaluating' | 'showingResult';

const PartButton: React.FC<{ title: string, description: string, onClick: () => void }> = ({ title, description, onClick }) => (
    <button
        onClick={onClick}
        className="w-full text-left p-6 border-2 rounded-lg hover:border-primary/50 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all duration-200"
    >
        <h4 className="text-xl font-bold text-dark">{title}</h4>
        <p className="text-secondary mt-1">{description}</p>
    </button>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
);


const TestMode: React.FC<TestModeProps> = ({ onSwitchToPractice }) => {
    const [stage, setStage] = useState<TestStage>('selectingPart');
    const [testPart, setTestPart] = useState<'part1' | 'part2/3' | null>(null);
    const [question, setQuestion] = useState('');
    const [result, setResult] = useState<TestEvaluationResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [evaluationTimestamp, setEvaluationTimestamp] = useState<string | null>(null);

    const { maxRecordingSeconds } = useMemo(() => {
        return testPart === 'part1' ? { maxRecordingSeconds: 45 } : { maxRecordingSeconds: 120 };
    }, [testPart]);
    
    const { recorderState, audioURL, audioBlob, startRecording: startAudioRecording, stopRecording: stopAudioRecording, resetRecording, error: recorderError, recordingTime, mediaStream } = useAudioRecorder({ maxRecordingSeconds });
    
    const formatTime = (seconds: number): string => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    const handlePartSelect = (part: 'part1' | 'part2/3') => {
        setTestPart(part);
        setStage('recording');
        setError(null);
    };
    
    const startRecording = () => {
        setResult(null); // Clear previous results
        startAudioRecording();
    };
    
    const stopRecording = () => {
        stopAudioRecording();
    };

    const handleEvaluation = async (evaluationType: 'standard' | 'advanced') => {
        if (!audioBlob || !question.trim()) {
            setError("Please provide a question and a complete recording before submitting.");
            return;
        }
        setStage('evaluating');
        setError(null);

        try {
            const audioMimeType = audioBlob.type;
            const audioBase64 = await blobToBase64(audioBlob);
            const evaluationResult = await getTestEvaluation(audioBase64, audioMimeType, question, evaluationType);
            
            // Set timestamp
            const now = new Date();
            setEvaluationTimestamp(now.toLocaleString('en-US', {
                dateStyle: 'full',
                timeStyle: 'medium'
            }));

            setResult(evaluationResult);
            setStage('showingResult');
        } catch (err) {
            setError(getFriendlyErrorMessage(err));
            setStage('recording'); // Go back to recording stage on error
        }
    };
    
    const handleStartOver = () => {
        setStage('selectingPart');
        setTestPart(null);
        setQuestion('');
        setResult(null);
        setError(null);
        setEvaluationTimestamp(null);
        resetRecording();
    };
    
    const radius = 45;
    const circumference = 2 * Math.PI * radius;
    const progress = maxRecordingSeconds > 0 ? (recordingTime / maxRecordingSeconds) * 100 : 0;
    const offset = circumference - (progress / 100) * circumference;

    if (stage === 'selectingPart') {
        return (
            <div className="w-full max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-lg text-center animate-fade-in">
                <h2 className="text-3xl font-bold text-dark mb-2">IELTS Speaking Test</h2>
                <p className="text-secondary mb-8 text-lg">Select which part of the test you want to perform.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <PartButton title="Part 1" description="Answer short, personal questions." onClick={() => handlePartSelect('part1')} />
                    <PartButton title="Part 2 / 3" description="Give a monologue or discuss abstract topics." onClick={() => handlePartSelect('part2/3')} />
                </div>
            </div>
        );
    }
    
    if (stage === 'evaluating') {
        return (
            <div className="mt-8 bg-white p-6 rounded-xl shadow-lg flex flex-col items-center justify-center h-64">
                <Loader className="w-10 h-10 text-primary" />
                <p className="mt-4 text-secondary font-medium">Evaluating your speech... this may take a moment.</p>
            </div>
        );
    }
    
    if (stage === 'showingResult' && result) {
        return (
            <TestResultDisplay 
                result={result} 
                audioURL={audioURL} 
                timestamp={evaluationTimestamp}
                onStartOver={handleStartOver} 
                onSwitchToPractice={onSwitchToPractice} 
            />
        );
    }

    const isSubmitDisabled = !audioBlob || !question.trim() || recorderState !== 'finished';

    return (
        <div className="max-w-4xl mx-auto">
            <button 
                onClick={handleStartOver}
                className="mb-6 inline-flex items-center text-sm font-medium text-secondary hover:text-primary transition-colors"
                aria-label="Change test part"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Change Test Part
            </button>
            <div className="bg-white p-6 rounded-xl shadow-lg space-y-6">
                <div>
                    <h2 className="text-2xl font-semibold text-dark">
                        Test: {testPart === 'part1' ? 'Part 1' : 'Part 2 / 3'}
                    </h2>
                     <p className="text-secondary mt-1">Enter the question or topic, then record your response below.</p>
                </div>
                
                 <div>
                    <label htmlFor="question-input" className="block text-sm font-medium text-gray-700 mb-1">Question / Topic</label>
                    <textarea
                        id="question-input"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder={testPart === 'part1' ? "E.g., What kind of music do you like?" : "E.g., Describe a memorable trip you have taken."}
                        className="w-full h-24 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition duration-200 resize-y"
                        disabled={recorderState === 'recording'}
                    />
                 </div>

                 <div className="border-t pt-6">
                    <h3 className="text-xl font-semibold text-dark mb-4">Record Your Response</h3>
                     <div className="p-4 bg-gray-100 rounded-lg">
                        {recorderState === 'recording' ? (
                            <div className="w-full flex flex-col sm:flex-row items-center justify-center gap-6">
                                {/* Timer Circle */}
                                <div className="relative w-24 h-24 flex-shrink-0">
                                    <svg className="w-full h-full" viewBox="0 0 100 100">
                                        <circle className="text-gray-300" strokeWidth="8" stroke="currentColor" fill="transparent" r={radius} cx="50" cy="50"/>
                                        <circle
                                            className="text-danger"
                                            strokeWidth="8"
                                            strokeLinecap="round"
                                            stroke="currentColor"
                                            fill="transparent"
                                            r={radius}
                                            cx="50"
                                            cy="50"
                                            style={{
                                                strokeDasharray: circumference,
                                                strokeDashoffset: offset,
                                                transform: 'rotate(-90deg)',
                                                transformOrigin: '50% 50%',
                                                transition: 'stroke-dashoffset 0.5s linear',
                                            }}
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <span className="font-mono text-xl font-bold text-dark">{formatTime(recordingTime)}</span>
                                    </div>
                                </div>

                                {/* Sound Wave */}
                                <div className="w-full max-w-[200px] sm:max-w-[250px]">
                                    {mediaStream && <SoundWave 
                                        mediaStream={mediaStream} 
                                        width={250} 
                                        height={60} 
                                        baseColor="#FCA5A5"   
                                        activeColor="#DC3545" 
                                    />}
                                </div>
                                
                                {/* Stop Button */}
                                <button onClick={stopRecording} className="flex items-center justify-center w-full sm:w-auto gap-2 px-6 py-3 bg-danger text-white font-bold rounded-lg hover:bg-red-600 transition duration-200 shrink-0">
                                    <StopIcon />
                                    <span>Stop Recording</span>
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col sm:flex-row items-center gap-4">
                                <div className="flex items-center gap-3 w-full sm:w-auto">
                                  <button onClick={startRecording} className="flex items-center justify-center w-full sm:w-auto gap-2 px-6 py-3 bg-primary text-white font-bold rounded-lg hover:bg-blue-600 transition duration-200 shrink-0">
                                      <MicIcon />
                                      {recorderState === 'finished' ? 'Record Again' : 'Start Recording'}
                                  </button>
                                  {recorderState === 'finished' && audioURL && (
                                     <a 
                                       href={audioURL} 
                                       download="test-recording.webm"
                                       className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-secondary text-secondary font-bold rounded-lg hover:bg-gray-50 transition duration-200"
                                       title="Tải audio bài thi vừa ghi"
                                     >
                                       <DownloadIcon />
                                       <span>Tải audio</span>
                                     </a>
                                  )}
                                </div>

                                {audioURL && (
                                    <div className="w-full flex items-center gap-2 p-2 bg-white rounded-md border shadow-sm">
                                    <audio src={audioURL} controls className="w-full" aria-label="Your audio recording" />
                                    </div>
                                )}
                            </div>
                        )}
                         {(recorderError || error) && (
                            <div className="mt-3 text-red-600 text-sm" role="alert">
                                {recorderError || error}
                            </div>
                        )}
                    </div>
                </div>
                 
                <div className="border-t pt-6">
                    <h3 className="text-xl font-semibold mb-2 text-dark">Submit for Evaluation</h3>
                    <p className="text-secondary mb-4">Choose an evaluation type. Both use strict IELTS scoring, but provide different levels of feedback.</p>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="w-full">
                            <button
                                onClick={() => handleEvaluation('standard')}
                                disabled={isSubmitDisabled}
                                className="w-full flex justify-center items-center bg-success text-white font-bold py-3 px-4 rounded-lg hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success disabled:bg-gray-400 disabled:cursor-not-allowed transition duration-200"
                            >
                                Standard Evaluation
                            </button>
                            <p className="text-xs text-secondary mt-2 px-1 text-center sm:text-left">
                                Provides a simpler, more accessible revised script. Ideal for intermediate learners.
                            </p>
                        </div>
                        <div className="w-full">
                            <button
                                onClick={() => handleEvaluation('advanced')}
                                disabled={isSubmitDisabled}
                                className="w-full flex justify-center items-center bg-white border border-secondary text-secondary font-bold py-3 px-4 rounded-lg hover:bg-secondary/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-secondary disabled:bg-gray-400 disabled:text-white disabled:border-gray-400 disabled:cursor-not-allowed transition duration-200"
                            >
                                Advanced Evaluation
                            </button>
                            <p className="text-xs text-secondary mt-2 px-1 text-center sm:text-left">
                                Provides a more sophisticated, high-level revised script for advanced learners.
                            </p>
                        </div>
                    </div>
                     <p className="text-xs text-secondary mt-4 text-center">
                        You must enter a question and record your audio before you can submit.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default TestMode;
