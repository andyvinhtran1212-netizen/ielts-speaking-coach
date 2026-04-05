
import React, { useRef } from 'react';
import type { TestEvaluationResult } from '../types';
import ScoreCircle from './ScoreCircle';

// Let TypeScript know that html2canvas is available on the window object
declare var html2canvas: any;

interface TestResultDisplayProps {
    result: TestEvaluationResult;
    audioURL: string | null;
    timestamp: string | null;
    onStartOver: () => void;
    onSwitchToPractice: () => void;
}

// Icons for sections
const CriteriaIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
const ScriptIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
const AudioIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>;
const ThumbsUpIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 inline mr-1.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.085a2 2 0 00-1.736.97l-2.714 4.224a2 2 0 01-1.226 1.006H4V20h3v-8.571L14 10z" /></svg>;
const ThumbsDownIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 inline mr-1.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.738 3h4.017c.163 0 .326.02.485.06L17 4m-7 10v5a2 2 0 002 2h.085a2 2 0 001.736-.97l2.714-4.224a2 2 0 011.226-1.006H20V4h-3v8.571L10 14z" /></svg>;


const CriteriaCard: React.FC<{ title: string; title_vi: string; feedback: string }> = ({ title, title_vi, feedback }) => {
    // Helper function to parse a section (strengths or weaknesses)
    const parseSection = (text: string | undefined): string[] => {
        if (!text) return [];
        return text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('-'))
            .map(line => line.substring(1).trim())
            .filter(Boolean); // Also remove empty strings after trimming
    };

    // Use a regex that is case-insensitive and handles potential whitespace
    const parts = feedback.split(/Điểm\s+yếu:/i);
    const strengthsText = parts[0];
    const weaknessesText = parts.length > 1 ? parts[1] : undefined;
    
    const strengths = parseSection(strengthsText?.replace(/Điểm\s+mạnh:/i, ''));
    const weaknesses = parseSection(weaknessesText);

    return (
        <div className="bg-white p-4 rounded-lg border h-full flex flex-col">
            <h4 className="font-semibold text-gray-800">{title}</h4>
            <p className="text-sm text-secondary mb-3">{title_vi}</p>
            <div className="flex-grow space-y-4">
                {strengths.length > 0 && (
                    <div>
                        <h5 className="font-semibold text-sm text-green-700 flex items-center">
                            <ThumbsUpIcon />
                            Điểm mạnh (Strengths)
                        </h5>
                        <ul className="list-disc list-inside text-sm text-dark space-y-1.5 mt-2 pl-2">
                            {strengths.map((item, index) => <li key={`s-${index}`}>{item}</li>)}
                        </ul>
                    </div>
                )}
                {weaknesses.length > 0 && (
                    <div>
                        <h5 className="font-semibold text-sm text-red-700 flex items-center">
                            <ThumbsDownIcon />
                            Điểm yếu (Weaknesses)
                        </h5>
                        <ul className="list-disc list-inside text-sm text-dark space-y-1.5 mt-2 pl-2">
                            {weaknesses.map((item, index) => <li key={`w-${index}`}>{item}</li>)}
                        </ul>
                    </div>
                )}
                 {strengths.length === 0 && weaknesses.length === 0 && (
                     <p className="text-sm text-dark">{feedback}</p> // Fallback
                 )}
            </div>
        </div>
    );
};


const TestResultDisplay: React.FC<TestResultDisplayProps> = ({ result, audioURL, timestamp, onStartOver, onSwitchToPractice }) => {
    const resultsRef = useRef<HTMLDivElement>(null);
    
    const handleExportAsImage = () => {
        const elementToCapture = resultsRef.current;
        if (elementToCapture && typeof html2canvas !== 'undefined') {
            html2canvas(elementToCapture, {
                useCORS: true,
                scale: 2, // Higher scale for better quality
                backgroundColor: '#f9fafb', // Match the bg-gray-50
                scrollY: -window.scrollY // Account for the user scrolling down the page
            }).then((canvas: HTMLCanvasElement) => {
                const link = document.createElement('a');
                link.download = 'speakwise-test-result.png';
                link.href = canvas.toDataURL('image/png');
                link.click();
            }).catch((err: any) => {
                console.error("Failed to export image:", err);
                alert("Sorry, there was an error exporting your results as an image.");
            });
        } else {
             alert("The export feature is currently unavailable. Please try again later.");
        }
    };
    
    const suggestionsList = result.suggestions_vi
        .split('\n')
        .map(item => item.trim())
        .filter(item => item.startsWith('-'))
        .map(item => item.substring(1).trim())
        .filter(Boolean);
        
    const showRepracticeRecommendation = result.overallScore <= 60;

    return (
        <div className="w-full max-w-4xl mx-auto animate-fade-in space-y-8">
            <div ref={resultsRef} className="bg-gray-50 p-6 sm:p-8 rounded-xl shadow-lg space-y-8">
                <h2 className="text-3xl font-bold text-dark text-center">Your Test Results</h2>
                
                {timestamp && (
                    <p className="text-center text-slate-500 font-medium -mt-6">
                        {timestamp}
                    </p>
                )}
                
                {/* Main Score & Summary Card */}
                <div className="bg-white p-6 rounded-xl shadow-md grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                    <div className="md:col-span-1">
                        <ScoreCircle score={result.overallScore} />
                    </div>
                    <div className="md:col-span-2">
                        <h3 className="text-xl font-semibold text-dark mb-2">Summary (Tổng kết)</h3>
                        <p className="text-dark border-l-4 border-primary bg-primary/5 p-4 rounded-r-lg">{result.summary_vi}</p>
                    </div>
                </div>

                {/* Suggestions Card */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <h3 className="text-xl font-semibold text-dark mb-4">💡 Suggestions for Improvement (Gợi ý cải thiện)</h3>
                    <div className="space-y-3">
                        {suggestionsList.length > 0 ? (
                            suggestionsList.map((suggestion, index) => (
                                <div key={index} className="flex items-start p-4 bg-primary/5 border-l-4 border-primary rounded-md shadow-sm">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-3 text-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    <p className="text-sm text-dark font-medium">{suggestion}</p>
                                </div>
                            ))
                        ) : (
                            <p className="text-sm text-gray-700">{result.suggestions_vi}</p>
                        )}
                    </div>
                </div>

                {/* Detailed Analysis */}
                <div className="bg-white p-6 rounded-xl shadow-md">
                    <h3 className="text-2xl font-bold text-dark mb-4">Detailed Analysis</h3>
                    <div className="space-y-8">
                        {/* --- Criteria Section --- */}
                        <div>
                             <h4 className="text-xl font-semibold text-dark mb-3 flex items-center"><CriteriaIcon /> IELTS Criteria</h4>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <CriteriaCard title="Fluency & Coherence" title_vi="Độ trôi chảy và mạch lạc" feedback={result.ieltsCriteriaFeedback.fluency_vi} />
                                <CriteriaCard title="Lexical Resource" title_vi="Vốn từ vựng" feedback={result.ieltsCriteriaFeedback.lexicalResource_vi} />
                                <CriteriaCard title="Grammatical Range & Accuracy" title_vi="Ngữ pháp" feedback={result.ieltsCriteriaFeedback.grammaticalRangeAndAccuracy_vi} />
                                <CriteriaCard title="Pronunciation" title_vi="Phát âm" feedback={result.ieltsCriteriaFeedback.pronunciation_vi} />
                             </div>
                        </div>

                        {/* --- Script Section --- */}
                        <div className="border-t pt-6">
                             <h4 className="text-xl font-semibold text-dark mb-3 flex items-center"><ScriptIcon /> Script Comparison</h4>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div>
                                    <h5 className="font-semibold text-gray-800 mb-2">Your Transcribed Speech</h5>
                                     <div className="bg-gray-50 p-4 border-l-4 border-secondary rounded-r-lg h-full">
                                        <p className="text-dark whitespace-pre-wrap leading-relaxed text-sm">{result.transcribedScript || "No speech was transcribed."}</p>
                                     </div>
                                </div>
                                 {result.improvedScript && (
                                     <div>
                                        <h5 className="font-semibold text-gray-800 mb-2">AI Suggested Improvement</h5>
                                        <div className="bg-green-50 p-4 border-l-4 border-success rounded-r-lg h-full">
                                            <p className="text-dark whitespace-pre-wrap leading-relaxed text-sm">{result.improvedScript}</p>
                                        </div>
                                    </div>
                                 )}
                             </div>
                        </div>

                         {/* --- Audio Section --- */}
                         {audioURL && (
                            <div className="border-t pt-6">
                                 <h4 className="text-xl font-semibold text-dark mb-3 flex items-center"><AudioIcon /> Your Recording</h4>
                                <audio src={audioURL} controls className="w-full" aria-label="Your audio recording" />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Recommendation & Actions */}
            <div className="space-y-6">
                {showRepracticeRecommendation && (
                    <div className="p-4 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 rounded-lg shadow-md">
                        <h4 className="font-bold">Recommendation</h4>
                        <p className="mt-1 text-sm">Your score suggests there are key areas to improve. We recommend you re-practice this content in the 'Practice' tab to get detailed feedback and improve your script.</p>
                        <button
                            onClick={onSwitchToPractice}
                            className="mt-3 bg-yellow-400 text-yellow-900 font-bold py-2 px-4 rounded-lg hover:bg-yellow-500 transition-colors"
                        >
                            Go to Practice Tab
                        </button>
                    </div>
                )}
                 <div className="bg-white p-6 rounded-xl shadow-lg flex flex-col md:flex-row items-center justify-between gap-4">
                    <h3 className="text-lg font-semibold text-dark">Manage Your Results</h3>
                    <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                        {audioURL && (
                            <a 
                                href={audioURL} 
                                download="speakwise-recording.m4a"
                                className="w-full sm:w-auto text-center bg-white border border-secondary text-secondary font-bold py-2 px-4 rounded-lg hover:bg-secondary/10 transition duration-200"
                            >
                                Download Audio
                            </a>
                        )}
                        <button
                            onClick={handleExportAsImage}
                            className="w-full sm:w-auto bg-white border border-primary text-primary font-bold py-2 px-4 rounded-lg hover:bg-primary/10 transition duration-200"
                        >
                            Export as Photo
                        </button>
                    </div>
                </div>

                <div className="pt-2 text-center">
                    <button
                        onClick={onStartOver}
                        className="w-full md:w-auto flex justify-center items-center mx-auto bg-primary text-white font-bold py-3 px-8 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-200"
                    >
                        Take Another Test
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TestResultDisplay;
