
import React, { useState, useRef } from 'react';
import type { AnalysisResult } from './types';
import { analyzeScript } from './services/geminiService';
import { trackScriptAnalysis } from './services/trackingService';
import ScriptInput from './components/ScriptInput';
import FeedbackDisplay from './components/FeedbackDisplay';
import StudentCodeInput from './components/StudentCodeInput';
import PracticeSetup from './components/PracticeSetup';
import Tabs from './components/Tabs';
import TestMode from './components/TestMode';

export const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            const base64data = reader.result as string;
            resolve(base64data.split(',')[1]);
        };
        reader.onerror = (error) => {
            reject(error);
        };
    });
};

export const getFriendlyErrorMessage = (error: unknown): string => {
    console.error("Caught application error:", error);
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes("failed to get analysis")) {
            return "Sorry, we couldn't analyze your script. The AI service may be temporarily unavailable. Please try again.";
        }
        if (message.includes("failed to get test evaluation")) {
            return "Sorry, we couldn't evaluate your test response. Please check your internet connection and try again.";
        }
    }
    return "An unexpected error occurred. Please refresh the page and try again.";
};

const App: React.FC = () => {
  const [studentCode, setStudentCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'practice' | 'test'>('practice');
  const [testPart, setTestPart] = useState<'part1' | 'part2' | 'part3' | null>(null);

  const [question, setQuestion] = useState<string>('');
  const [script, setScript] = useState<string>('');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [currentAnalysisType, setCurrentAnalysisType] = useState<'standard' | 'advanced' | null>(null);
  
  const [isAnalysisLoading, setIsAnalysisLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isTestUnlocked, setIsTestUnlocked] = useState<boolean>(false);

  const questionInputRef = useRef<HTMLTextAreaElement>(null);

  const handleStartOver = () => {
    setTestPart(null);
    setQuestion('');
    setScript('');
    setAnalysisResult(null);
    setError(null);
    setCurrentAnalysisType(null);
  };
  
  const handleLoginSuccess = (code: string) => {
    setStudentCode(code);
  };

  const handleLogout = () => {
    setStudentCode(null);
    handleStartOver();
    setIsTestUnlocked(false);
  };

  const handleAnalyzeScript = async (scriptToAnalyze: string, analysisType: 'standard' | 'advanced') => {
    if (!question.trim()) {
      setError('Please enter the question you are answering.');
      questionInputRef.current?.focus();
      return;
    }
    if (!scriptToAnalyze.trim()) {
      setError('Script is empty, cannot analyze.');
      return;
    }
    
    setIsAnalysisLoading(true);
    setLoadingMessage(`Analyzing for ${analysisType} proficiency...`);
    setError(null);
    setAnalysisResult(null);
    setCurrentAnalysisType(null);

    const cacheKey = `analysis:${analysisType}:${question.trim()}:${scriptToAnalyze.trim()}`;
    try {
        const cachedResult = sessionStorage.getItem(cacheKey);
        if (cachedResult) {
            const result = JSON.parse(cachedResult) as AnalysisResult;
            setAnalysisResult(result);
            setCurrentAnalysisType(analysisType);
            if (result.keyMetrics.overallScore && result.keyMetrics.overallScore >= 55) {
                setIsTestUnlocked(true);
            }
            setIsAnalysisLoading(false);
            return;
        }
    } catch (e) { console.warn("Cache error", e); }

    try {
      const result = await analyzeScript(scriptToAnalyze, question, analysisType);
      try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch (e) {}
      
      setAnalysisResult(result);
      setCurrentAnalysisType(analysisType);
      if (result.keyMetrics.overallScore && result.keyMetrics.overallScore >= 55) {
          setIsTestUnlocked(true);
      }
      if (studentCode) {
        trackScriptAnalysis(studentCode, scriptToAnalyze, result);
      }
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsAnalysisLoading(false);
      setLoadingMessage('');
    }
  };

  if (!studentCode) {
    return <StudentCodeInput onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans antialiased text-slate-900">
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
           <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-primary-500/20">W</div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-primary-700">SpeakWise AI</h1>
              <p className="hidden md:block text-slate-500 text-xs font-medium uppercase tracking-wider">English Proficiency Coach</p>
            </div>
          </div>
           <div className="flex items-center gap-4">
             <div className="hidden sm:block text-right">
               <p className="text-xs font-semibold text-slate-400">Student Account</p>
               <p className="text-sm font-bold text-slate-700">{studentCode}</p>
             </div>
             <button 
               onClick={handleLogout} 
               className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-primary-600"
               title="Change Session"
             >
               <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                 <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd" />
               </svg>
             </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-6 py-10">
        <div className="mb-10 flex justify-center">
          <Tabs activeTab={activeTab} setActiveTab={setActiveTab} isTestUnlocked={isTestUnlocked} />
        </div>
        
        <div className="space-y-12">
            {activeTab === 'practice' && (
              !testPart ? (
                <PracticeSetup onSetupComplete={setTestPart} />
              ) : (
                <div className="animate-fade-in-up space-y-10">
                  <button 
                    onClick={handleStartOver}
                    className="group inline-flex items-center text-sm font-semibold text-slate-500 hover:text-primary-600 transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5 transform group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                    Setup New Session
                  </button>
                  
                  <ScriptInput
                    question={question}
                    onQuestionChange={setQuestion}
                    script={script}
                    onScriptChange={setScript}
                    onAnalyze={(analysisType) => handleAnalyzeScript(script, analysisType)}
                    isLoading={isAnalysisLoading}
                    questionRef={questionInputRef}
                  />

                  {error && (
                    <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl flex items-center gap-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm font-medium">{error}</p>
                    </div>
                  )}

                  <FeedbackDisplay 
                    isLoading={isAnalysisLoading} 
                    loadingMessage={loadingMessage} 
                    analysisResult={analysisResult}
                    originalScript={script}
                  />

                  {analysisResult?.keyMetrics?.overallScore !== undefined && analysisResult.keyMetrics.overallScore >= 55 && (
                    <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in-up">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-emerald-800 font-bold text-lg">You've passed!</h3>
                          <p className="text-emerald-600 text-sm">Now you can start the test mode for exported results.</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setActiveTab('test')}
                        className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors shadow-lg shadow-emerald-500/30 whitespace-nowrap"
                      >
                        Start Test Mode
                      </button>
                    </div>
                  )}

                  {analysisResult?.keyMetrics?.overallScore !== undefined && analysisResult.keyMetrics.overallScore < 55 && (
                    <div className="p-6 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-fade-in-up">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-amber-600">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-amber-800 font-bold text-lg">Keep Practicing!</h3>
                          <p className="text-amber-600 text-sm">You need a slightly higher proficiency score to unlock Test Mode. Review the feedback and try again.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
            {activeTab === 'test' && <TestMode onSwitchToPractice={() => setActiveTab('practice')} />}
        </div>
      </main>
      
      <footer className="text-center py-12 text-slate-400 text-xs font-medium tracking-wide">
        <p>© 2024 SpeakWise AI • Optimized with Gemini AI</p>
      </footer>
    </div>
  );
};

export default App;
