import React, { useCallback, useState } from 'react';
import type { RecordedAnswer, PartPracticeAnalysis } from '../types';
import { generatePartPracticeAnalysis } from '../services/geminiService';
import { BookOpenIcon, LightBulbIcon, MicIcon, PencilSquareIcon, PlayIcon, StopIcon, ArrowDownTrayIcon } from './Icons';

interface ExtraAnalysisViewProps {
  structuredAnswers: RecordedAnswer[];
}

const categoryIcons: { [key: string]: React.ReactElement } = {
    Grammar: <BookOpenIcon className="w-6 h-6 text-blue-600 shrink-0" />,
    Vocabulary: <LightBulbIcon className="w-6 h-6 text-yellow-600 shrink-0" />,
    Phrasing: <PencilSquareIcon className="w-6 h-6 text-green-600 shrink-0" />,
    "Pronunciation Hint": <MicIcon className="w-6 h-6 text-purple-600 shrink-0" />,
};

const criteriaVietnamese = {
    fluency: "Độ trôi chảy & mạch lạc",
    lexicalResource: "Vốn từ vựng",
    grammar: "Ngữ pháp",
    pronunciation: "Phát âm"
};

const ScoreCircle: React.FC<{ score: number }> = ({ score }) => (
    <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center bg-white shadow-inner shrink-0 border-[6px] border-neutral-50">
        <svg className="absolute top-0 left-0 w-full h-full -rotate-90 transform" viewBox="0 0 36 36">
            <path className="text-neutral-100" strokeWidth="3" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path className="text-brand-primary transition-all duration-1000 ease-out" strokeWidth="3" strokeDasharray={`${(score / 9) * 100}, 100`} strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        </svg>
        <div className="flex flex-col items-center justify-center">
            <span className="text-4xl sm:text-5xl font-display font-extrabold text-brand-dark tracking-tighter">{score.toFixed(1)}</span>
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mt-0.5">Band</span>
        </div>
    </div>
);

const AudioPlayer: React.FC<{ blob: Blob }> = ({ blob }) => {
    const [audioUrl, setAudioUrl] = React.useState('');
    const audioRef = React.useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = React.useState(false);

    React.useEffect(() => {
        if (!blob || blob.size === 0) return;

        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        return () => {
            URL.revokeObjectURL(url);
        };
    }, [blob]);
    
    const togglePlayback = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
    };
    
    React.useEffect(() => {
        const audio = audioRef.current;
        if (audio) {
            const onPlaying = () => setIsPlaying(true);
            const onPause = () => setIsPlaying(false);
            const onEnded = () => setIsPlaying(false);
            audio.addEventListener('playing', onPlaying);
            audio.addEventListener('pause', onPause);
            audio.addEventListener('ended', onEnded);
            return () => {
                audio.removeEventListener('playing', onPlaying);
                audio.removeEventListener('pause', onPause);
                audio.removeEventListener('ended', onEnded);
            };
        }
    }, []);

    if (!audioUrl) return null;

    return (
        <div className="flex items-center gap-4">
            <audio ref={audioRef} src={audioUrl} preload="auto" className="hidden"></audio>
            <button onClick={togglePlayback} className={`flex items-center px-5 py-2.5 text-sm font-bold rounded-xl transition-all shadow-sm hover:shadow-md ${isPlaying ? 'bg-red-50 text-red-600 border border-red-100 hover:bg-red-100' : 'bg-brand-light text-brand-primary border border-brand-primary/10 hover:bg-brand-primary/20'}`}>
                {isPlaying ? <StopIcon className="w-5 h-5 mr-2"/> : <PlayIcon className="w-5 h-5 mr-2"/>}
                {isPlaying ? 'Dừng' : 'Nghe lại'}
            </button>
        </div>
    );
};


const AnalysisCard: React.FC<{ answer: RecordedAnswer }> = ({ answer }) => {
    const [analysis, setAnalysis] = useState<PartPracticeAnalysis | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleGetAnalysis = useCallback(async () => {
        if (!answer.transcript) {
            setError('No transcript available to analyze.');
            return;
        }
        setIsLoading(true);
        setError('');
        try {
            const result = await generatePartPracticeAnalysis(answer.question, answer.transcript);
            setAnalysis(result);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'An unknown error occurred.';
            if (errorMsg.includes('429')) {
                setError('Rate limit reached. Please wait a moment before trying again.');
            } else {
                setError('Failed to generate analysis. Please try again.');
            }
            console.error(err);
        }
        setIsLoading(false);
    }, [answer.question, answer.transcript]);

    const handleDownloadAudio = useCallback(() => {
        if (!answer.audioBlob || answer.audioBlob.size === 0) return;

        const url = URL.createObjectURL(answer.audioBlob);
        const link = document.createElement('a');
        link.href = url;
        
        const sanitizedQuestion = answer.question
            .substring(0, 30)
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .replace(/\s+/g, '_');
            
        link.download = `IELTS_${answer.part.replace(/\s/g, '')}_${sanitizedQuestion}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [answer.audioBlob, answer.part, answer.question]);


    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm transition-all hover:shadow-md mb-6 border border-neutral-100 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-brand-secondary"></div>
            <div className="font-semibold text-brand-dark mb-4">
                <div className="inline-block bg-brand-light text-brand-primary font-bold px-3 py-1 rounded-full text-xs tracking-wide uppercase mb-3 border border-brand-primary/10">
                    {answer.part} <span className="text-brand-secondary mx-1">•</span> {answer.topic}
                </div>
                <p className="text-lg font-display font-bold my-1 whitespace-pre-wrap leading-snug">{answer.question}</p>
            </div>
            
            {answer.audioBlob && answer.audioBlob.size > 0 && (
                <div className="my-4 flex flex-wrap items-center gap-3">
                    <AudioPlayer blob={answer.audioBlob} />
                    <button
                        onClick={handleDownloadAudio}
                        className="flex items-center px-4 py-2 text-sm font-bold text-neutral-600 bg-white rounded-xl border border-neutral-200 hover:bg-neutral-50 transition-all shadow-sm hover:shadow"
                    >
                        <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
                        Download Audio
                    </button>
                </div>
            )}

            {answer.transcript && (
                 <div className="mb-6 bg-neutral-50 p-5 rounded-xl border border-neutral-100">
                     <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-3 flex items-center">
                         <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                         Your Transcript
                     </p>
                     <blockquote className="text-neutral-700 whitespace-pre-wrap text-sm leading-relaxed font-medium">
                         {answer.transcript}
                     </blockquote>
                </div>
            )}
            
            <div className="mt-6 pt-6 border-t border-neutral-100">
                {analysis ? (
                    <div className="space-y-8 animate-fade-in">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <div className="space-y-6">
                                <div className="flex flex-col items-center justify-center p-6 bg-brand-light/50 rounded-2xl border border-brand-primary/10">
                                    <p className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4">Estimated Band Score</p>
                                    <ScoreCircle score={analysis.overallBandScore} />
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-brand-dark uppercase tracking-wider mb-3 flex items-center">
                                        <PencilSquareIcon className="w-5 h-5 mr-2 text-brand-primary" />
                                        Your Answer with Highlights
                                    </h4>
                                    <blockquote className="bg-neutral-50 p-5 rounded-xl border border-neutral-100 text-neutral-700 leading-relaxed max-h-60 overflow-y-auto text-sm custom-scrollbar">
                                        {analysis.highlightedTranscript.map((segment, i) => (
                                            <span key={i} className={segment.isMistake ? 'font-bold text-rose-600 bg-rose-50 rounded px-1 border-b border-rose-200' : ''}>{segment.text}</span>
                                        ))}
                                    </blockquote>
                                </div>
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-brand-dark uppercase tracking-wider mb-4 flex items-center">
                                    <svg className="w-5 h-5 mr-2 text-brand-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    Detailed Feedback
                                </h4>
                                <div className="space-y-4 text-sm">
                                    {Object.entries(analysis.feedback).map(([key, value]) => (
                                        <div key={key} className="bg-white p-4 rounded-xl border border-neutral-100 shadow-sm">
                                            <p className="font-bold text-brand-primary capitalize mb-2 text-xs tracking-wider uppercase">{criteriaVietnamese[key as keyof typeof criteriaVietnamese]}</p>
                                            <p className="text-neutral-600 whitespace-pre-wrap leading-relaxed">{value}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        
                        {analysis.corrections.length > 0 && (
                            <div className="bg-neutral-50 p-6 rounded-2xl border border-neutral-100">
                                <h4 className="text-sm font-bold text-brand-dark uppercase tracking-wider mb-5 flex items-center">
                                    <LightBulbIcon className="w-5 h-5 mr-2 text-amber-500" />
                                    Suggestions for Improvement
                                </h4>
                                <div className="space-y-4">
                                    {analysis.corrections.map((item, i) => (
                                        <div key={i} className="bg-white p-5 rounded-xl shadow-sm border border-neutral-100 transition-all hover:shadow-md">
                                            <div className="flex items-center gap-3 mb-4 border-b border-neutral-50 pb-3">
                                                <div className="w-8 h-8 rounded-full bg-neutral-50 flex items-center justify-center border border-neutral-100">
                                                    {categoryIcons[item.category] || <BookOpenIcon className="w-4 h-4 text-neutral-500 shrink-0" />}
                                                </div>
                                                <p className="font-bold text-brand-dark text-sm uppercase tracking-wider">{item.category}</p>
                                            </div>
                                            <div className="text-sm space-y-3">
                                                <div className="flex items-start gap-3">
                                                    <span className="shrink-0 w-20 text-xs font-bold text-neutral-400 uppercase tracking-wider mt-0.5">You said</span>
                                                    <span className="text-rose-600 font-medium bg-rose-50 px-2 py-0.5 rounded">"{item.incorrectPhrase}"</span>
                                                </div>
                                                <div className="flex items-start gap-3">
                                                    <span className="shrink-0 w-20 text-xs font-bold text-neutral-400 uppercase tracking-wider mt-0.5">Suggestion</span>
                                                    <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded">"{item.correction}"</span>
                                                </div>
                                                <div className="flex items-start gap-3 pt-2 border-t border-neutral-50">
                                                    <span className="shrink-0 w-20 text-xs font-bold text-neutral-400 uppercase tracking-wider mt-0.5">Why?</span>
                                                    <span className="text-neutral-600 leading-relaxed">{item.explanation}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div>
                            <h4 className="text-sm font-bold text-brand-dark uppercase tracking-wider mb-3 flex items-center">
                                <svg className="w-5 h-5 mr-2 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Sample Answer (Band 7+)
                            </h4>
                            <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 text-sm text-neutral-700 whitespace-pre-wrap font-serif leading-relaxed shadow-inner">
                                {analysis.sampleAnswer}
                            </div>
                        </div>
                    </div>
                ) : (
                     <div className="flex flex-col items-center justify-center py-4">
                        <button 
                            onClick={handleGetAnalysis} 
                            disabled={isLoading || !answer.transcript}
                            className="w-full sm:w-auto flex justify-center items-center px-8 py-3.5 text-sm font-bold text-white bg-brand-dark rounded-xl hover:bg-neutral-800 transition-all shadow-md hover:shadow-lg disabled:bg-neutral-300 disabled:shadow-none disabled:cursor-not-allowed"
                        >
                             {isLoading ? (
                                <>
                                 <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                 </svg>
                                 Analyzing with AI...
                                </>
                             ) : 'Get Detailed AI Analysis & Feedback'}
                        </button>
                        {error && <p className="text-center text-rose-500 text-xs mt-3 font-bold bg-rose-50 px-3 py-1.5 rounded-lg">{error}</p>}
                    </div>
                )}
            </div>
        </div>
    );
};


export const ExtraAnalysisView: React.FC<ExtraAnalysisViewProps> = ({ structuredAnswers }) => {
  return (
    <div className="space-y-6">
      {structuredAnswers.map((answer, index) => (
        <AnalysisCard key={index} answer={answer} />
      ))}
    </div>
  );
};
