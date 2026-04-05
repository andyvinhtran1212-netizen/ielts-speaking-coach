import React, { useState, useEffect, useCallback } from 'react';
import { PracticePart } from '../types';
import type { Part2CueCard, PracticeQuestion } from '../types';
import { generatePracticeSet, generateFollowUpPart3Set } from '../services/geminiService';
import { CheckIcon } from './Icons';
import { PartPracticeAnalysisCard } from './PartPracticeAnalysisCard';
import { unlockAudioContext } from '../utils/audioContext';
import { RecordingModal } from './RecordingModal';

// --- Main Component ---
interface PartPracticeViewProps {
  part: PracticePart;
  topics: string[];
  onEndPractice: () => void;
}
type PracticeStatus = 'generating_set' | 'practice_session' | 'results';

export const PartPracticeView: React.FC<PartPracticeViewProps> = ({ part, topics, onEndPractice }) => {
    const [status, setStatus] = useState<PracticeStatus>('generating_set');
    const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
    const [activeQuestion, setActiveQuestion] = useState<PracticeQuestion | null>(null);
    const [isRecordingModalOpen, setIsRecordingModalOpen] = useState(false);
    const [topic, setTopic] = useState('');
    const [currentPracticePart, setCurrentPracticePart] = useState<PracticePart>(part);
    const [lastPart2CueCard, setLastPart2CueCard] = useState<Part2CueCard | null>(null);
    const [isGeneratingPart3, setIsGeneratingPart3] = useState(false);

    const fetchNewSet = useCallback(async () => {
        setStatus('generating_set');
        setCurrentPracticePart(part); // Reset to original part when fetching a new set
        setLastPart2CueCard(null);

        const randomTopic = topics.length > 0 ? topics[Math.floor(Math.random() * topics.length)] : "a common topic";
        setTopic(randomTopic);
        const partString = part.replace('_', ' ') as 'Part 1' | 'Part 2' | 'Part 3';
        const result = await generatePracticeSet(partString, randomTopic);

        if (result.questions) {
            setQuestions(result.questions.map((q, i) => ({ id: i, questionText: q.text, cueCard: null, status: 'pending', audioBlob: null, transcript: null, analysis: null })));
        } else if (result.cueCard) {
            setLastPart2CueCard(result.cueCard);
            const fullPrompt = `${result.cueCard.instruction}\nYou should say:\n${result.cueCard.points.map(p => `\t•\t${p}`).join('\n')}`;
            setQuestions([{ id: 0, questionText: fullPrompt, cueCard: result.cueCard, status: 'pending', audioBlob: null, transcript: null, analysis: null }]);
        }
        setStatus('practice_session');
    }, [part, topics]);

    useEffect(() => { 
        const timer = setTimeout(() => {
            fetchNewSet();
        }, 0);
        return () => clearTimeout(timer);
    }, [fetchNewSet]);

    const handleOpenRecorder = (question: PracticeQuestion) => {
        unlockAudioContext();
        setActiveQuestion(question);
        setIsRecordingModalOpen(true);
    };

    const handleSaveRecording = useCallback((audioBlob: Blob, transcript: string) => {
        if (!activeQuestion) return;
        setQuestions(prev => prev.map(q => q.id === activeQuestion.id ? { ...q, status: 'answered', audioBlob, transcript } : q));
        setIsRecordingModalOpen(false);
        setActiveQuestion(null);
    }, [activeQuestion]);

    const handleCloseRecorder = useCallback(() => {
        setIsRecordingModalOpen(false);
        setActiveQuestion(null);
    }, []);
    
    const handleAnalyzeAll = () => {
        // In this version, analysis is done per-card, so this button is just for UI flow.
        // The actual analysis is triggered on the results cards.
        setStatus('results');
    };

    const handleContinueToPart3 = async () => {
        if (!lastPart2CueCard) return;
        setIsGeneratingPart3(true);
        const result = await generateFollowUpPart3Set(lastPart2CueCard);
        setTopic(result.topic);
        setCurrentPracticePart(PracticePart.Part3);
        setQuestions(result.questions.map((q, i) => ({ id: i, questionText: q.text, cueCard: null, status: 'pending', audioBlob: null, transcript: null, analysis: null })));
        setStatus('practice_session');
        setIsGeneratingPart3(false);
    };

    const answeredCount = questions.filter(q => q.status === 'answered').length;

    const renderContent = () => {
        switch (status) {
            case 'generating_set':
                return (
                    <div className="flex flex-col items-center justify-center py-12">
                        <svg className="animate-spin h-12 w-12 text-brand-primary mb-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        <h3 className="text-xl font-display font-bold text-brand-dark mb-2">Generating Question Set</h3>
                        <p className="text-neutral-500">Preparing your practice materials...</p>
                    </div>
                );
            
            case 'practice_session':
                return (
                    <div className="animate-fade-in flex flex-col h-full">
                        <div className="flex-1">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                               {questions.map((q, index) => (
                                   <div key={q.id} onClick={() => {
                                       if (!q.revealed) {
                                           setQuestions(prev => prev.map(pq => pq.id === q.id ? { ...pq, revealed: true } : pq));
                                           setTimeout(() => {
                                               handleOpenRecorder(q);
                                           }, 500); // Small delay to let them see it revealed before modal opens
                                       } else {
                                           handleOpenRecorder(q);
                                       }
                                   }} className={`p-6 bg-white rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition-all flex flex-col justify-between h-48 border-2 ${q.status === 'answered' ? 'border-emerald-200 bg-emerald-50/30' : 'border-neutral-100 hover:border-brand-secondary/50'}`}>
                                       <div className="flex-1 flex flex-col justify-center">
                                            {q.revealed ? (
                                                <p className="text-brand-dark font-medium text-sm sm:text-base leading-relaxed line-clamp-4">
                                                    {q.questionText}
                                                </p>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center text-neutral-400 group-hover:text-brand-primary transition-colors">
                                                    <span className="text-3xl font-display font-bold mb-2 opacity-50">Q{index + 1}</span>
                                                    <span className="text-xs font-bold uppercase tracking-widest">Click to reveal</span>
                                                </div>
                                            )}
                                       </div>
                                       <div className={`flex items-center justify-end text-xs font-bold uppercase tracking-wider mt-4 pt-4 border-t ${q.status === 'answered' ? 'text-emerald-600 border-emerald-100' : 'text-neutral-400 border-neutral-100'}`}>
                                           {q.status === 'answered' ? <><CheckIcon className="w-4 h-4 mr-1.5"/> Answered</> : 'Pending'}
                                       </div>
                                   </div>
                               ))}
                            </div>
                        </div>
                        <div className="text-center mt-10 pt-8 border-t border-neutral-100">
                            <button 
                                onClick={handleAnalyzeAll} 
                                disabled={answeredCount === 0} 
                                className="px-10 py-4 text-base font-bold text-white bg-brand-dark rounded-xl hover:bg-neutral-800 transition-all shadow-md hover:shadow-lg disabled:bg-neutral-300 disabled:shadow-none disabled:cursor-not-allowed"
                            >
                                Finish & See Analysis ({answeredCount}/{questions.length})
                            </button>
                        </div>
                    </div>
                );
            
            case 'results':
                return (
                    <div className="animate-fade-in flex flex-col h-full">
                        <div className="flex-1 overflow-y-auto pr-2 sm:pr-4 -mr-2 sm:-mr-4 custom-scrollbar">
                           {questions.filter(q => q.status === 'answered').map(q => (
                                <PartPracticeAnalysisCard 
                                    key={q.id}
                                    audioBlob={q.audioBlob}
                                    questionText={q.questionText}
                                    transcript={q.transcript}
                                />
                           ))}
                        </div>
                         <div className="mt-8 pt-6 border-t border-neutral-100 flex flex-col sm:flex-row justify-center gap-4">
                            <button 
                                onClick={fetchNewSet} 
                                className="px-8 py-3.5 font-bold text-brand-dark bg-white border-2 border-neutral-200 rounded-xl hover:bg-neutral-50 hover:border-neutral-300 transition-all shadow-sm"
                            >
                                Practice Another Topic
                            </button>
                            {currentPracticePart === PracticePart.Part2 && (
                                <button 
                                    onClick={handleContinueToPart3} 
                                    disabled={isGeneratingPart3} 
                                    className="px-8 py-3.5 font-bold text-white bg-brand-primary rounded-xl hover:bg-brand-dark transition-all shadow-md hover:shadow-lg disabled:bg-neutral-300 disabled:shadow-none flex items-center justify-center"
                                >
                                    {isGeneratingPart3 ? (
                                        <>
                                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                            Generating...
                                        </>
                                    ) : 'Continue with Part 3'}
                                </button>
                            )}
                        </div>
                    </div>
                );
            default: return null;
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-50/50 p-4 sm:p-8">
             <div className="w-full max-w-5xl">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-4">
                    <div>
                        <h1 className="text-3xl sm:text-4xl font-display font-bold text-brand-dark mb-2">Practice {currentPracticePart.replace('_', ' ')}</h1>
                        <p className="text-neutral-500 font-medium flex items-center">
                            <span className="uppercase tracking-widest text-xs font-bold mr-2 text-neutral-400">Topic</span>
                            <span className="text-brand-primary bg-brand-light px-3 py-1 rounded-full text-sm font-bold">{topic}</span>
                        </p>
                    </div>
                    <button 
                        onClick={onEndPractice} 
                        className="px-5 py-2.5 text-sm font-bold text-neutral-600 bg-white rounded-xl border border-neutral-200 hover:bg-neutral-50 transition-all shadow-sm hover:shadow"
                    >
                        End Session
                    </button>
                </div>
                <div className="bg-white p-6 sm:p-10 rounded-3xl shadow-sm border border-neutral-100 transition-all duration-500 min-h-[40rem] flex flex-col">
                   {renderContent()}
                </div>
            </div>
            {isRecordingModalOpen && activeQuestion && <RecordingModal question={activeQuestion} part={currentPracticePart} onSave={handleSaveRecording} onClose={handleCloseRecorder} />}
        </div>
    );
};