import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { PartPracticeAnalysis } from '../types';
import { PlayIcon, StopIcon, BookOpenIcon, LightBulbIcon, MicIcon, PencilSquareIcon, ArrowDownTrayIcon, DocumentTextIcon } from './Icons';
import { generatePartPracticeAnalysis } from '../services/geminiService';

// Use jsPDF and html2canvas from window object as they are loaded via CDN
declare global {
    interface Window {
        jspdf: any;
        html2canvas: any;
        docx: any;
    }
}

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


interface PartPracticeAnalysisCardProps {
    audioBlob: Blob | null;
    questionText: string;
    transcript: string | null;
}

export const PartPracticeAnalysisCard: React.FC<PartPracticeAnalysisCardProps> = ({ audioBlob, questionText, transcript }) => {
    const [analysis, setAnalysis] = useState<PartPracticeAnalysis | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [isExporting, setIsExporting] = useState(false);

    const [audioUrl, setAudioUrl] = useState('');
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const cardContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!audioBlob || audioBlob.size === 0) return;
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [audioBlob]);

    const togglePlayback = () => {
        if (!audioRef.current) return;
        if (isPlaying) audioRef.current.pause();
        else audioRef.current.play();
    };

    useEffect(() => {
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
    }, [audioRef]);

    const handleGetAnalysis = useCallback(async () => {
        if (!transcript) {
            setError('No transcript available to analyze.');
            return;
        }
        setIsLoading(true);
        setError('');
        try {
            const result = await generatePartPracticeAnalysis(questionText, transcript);
            setAnalysis(result);
        } catch (err) {
            setError('Failed to generate analysis. Please try again.');
            console.error(err);
        }
        setIsLoading(false);
    }, [questionText, transcript]);

    useEffect(() => {
        if (!analysis && transcript) {
            handleGetAnalysis();
        }
    }, [analysis, transcript, handleGetAnalysis]);

    const handleExportPdf = async () => {
        const { jsPDF } = window.jspdf;
        const input = cardContentRef.current;
        if (!input) return;

        setIsExporting(true);
        
        const clone = input.cloneNode(true) as HTMLElement;
        
        const details = clone.querySelectorAll('details');
        details.forEach(detail => detail.setAttribute('open', 'true'));

        const scrollableElements = clone.querySelectorAll('.max-h-60, .max-h-48, .overflow-y-auto');
        scrollableElements.forEach(el => {
            el.classList.remove('max-h-60', 'max-h-48', 'overflow-y-auto', 'custom-scrollbar');
            (el as HTMLElement).style.maxHeight = 'none';
            (el as HTMLElement).style.overflow = 'visible';
        });

        clone.style.position = 'absolute';
        clone.style.left = '-9999px';
        clone.style.top = '0';
        clone.style.width = `${input.offsetWidth}px`;
        document.body.appendChild(clone);

        try {
            const canvas = await window.html2canvas(clone, { 
                scale: 2, 
                backgroundColor: '#ffffff',
                useCORS: true,
                logging: false,
                scrollY: 0,
                scrollX: 0,
                windowWidth: clone.scrollWidth,
                windowHeight: clone.scrollHeight
            });
            
            const imgData = canvas.toDataURL('image/png', 1.0);
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });
            
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            
            const imgProps= pdf.getImageProperties(imgData);
            const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
            
            let heightLeft = imgHeight;
            let position = 0;

            pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
            heightLeft -= pageHeight;

            while (heightLeft > 0) {
                position -= pageHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            // Create a more descriptive and unique filename
            const sanitizedTopic = questionText
                .substring(0, 30) // Take first 30 chars
                .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
                .replace(/\s+/g, '_'); // Replace spaces with underscores

            pdf.save(`IELTS-Practice-Analysis_${sanitizedTopic}.pdf`);
        } catch (err) {
            console.error("Error exporting to PDF:", err);
            alert('An error occurred while exporting the PDF. Please try again.');
        } finally {
            document.body.removeChild(clone);
            setIsExporting(false);
        }
    };
    
    const handleExportDocx = async () => {
        if (!analysis) return;
        setIsExporting(true);

        const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;

        const createHeading = (text: string, level: any = HeadingLevel.HEADING_1) => new Paragraph({ text, heading: level, spacing: { after: 200 } });
        const createSubheading = (text: string) => new Paragraph({ children: [new TextRun({ text, bold: true })], spacing: { after: 100 } });
        const createPara = (text: string) => new Paragraph({ text, spacing: { after: 200 } });
        
        const highlightedTranscriptRuns = analysis.highlightedTranscript.map(segment =>
            new TextRun({
                text: segment.text,
                highlight: segment.isMistake ? 'yellow' : undefined,
                color: segment.isMistake ? 'D9534F' : undefined,
            })
        );
        
        const correctionsParagraphs = analysis.corrections.flatMap(item => [
            createSubheading(item.category),
            new Paragraph({
                children: [
                    new TextRun("You said: "),
                    new TextRun({ text: `"${item.incorrectPhrase}"`, color: 'D9534F', italics: true }),
                ]
            }),
             new Paragraph({
                children: [
                    new TextRun("Suggestion: "),
                    new TextRun({ text: `"${item.correction}"`, color: '5CB85C', bold: true }),
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun("Why? "),
                    new TextRun(item.explanation),
                ],
                spacing: { after: 300 }
            }),
        ]);

        const doc = new Document({
             sections: [{
                children: [
                    new Paragraph({ text: "IELTS Speaking Practice: Detailed Analysis", heading: HeadingLevel.TITLE, alignment: 'center' }),
                    createHeading("Question"),
                    createPara(questionText),

                    createHeading("Your Answer"),
                    new Paragraph({ children: highlightedTranscriptRuns, spacing: { after: 200 } }),
                    
                    createHeading("Estimated Band Score"),
                    createPara(analysis.overallBandScore.toFixed(1)),

                    createHeading("Detailed Feedback (Vietnamese)"),
                    ...Object.entries(analysis.feedback).map(([key, value]) => new Paragraph({
                        children: [
                            new TextRun({ text: `${criteriaVietnamese[key as keyof typeof criteriaVietnamese]}: `, bold: true }),
                            new TextRun(value)
                        ],
                        spacing: { after: 100 }
                    })),
                    
                    ...(analysis.corrections.length > 0 ? [createHeading("Suggestions for Improvement"), ...correctionsParagraphs] : []),

                    createHeading("Sample Answer (Band 7+)"),
                    createPara(analysis.sampleAnswer),
                ],
            }],
        });
        
        try {
            const blob = await Packer.toBlob(doc);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const sanitizedTopic = questionText
                .substring(0, 30)
                .replace(/[^a-zA-Z0-9\s]/g, '')
                .replace(/\s+/g, '_');
            a.download = `IELTS-Practice-Analysis_${sanitizedTopic}.docx`;
            a.href = url;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch(e) {
            console.error("Error creating DOCX file", e);
            alert("An error occurred while creating the DOCX file.");
        } finally {
            setIsExporting(false);
        }
    };

    const handleDownloadAudio = () => {
        if (!audioBlob || audioBlob.size === 0) return;

        const url = URL.createObjectURL(audioBlob);
        const link = document.createElement('a');
        link.href = url;
        
        const sanitizedQuestion = questionText
            .substring(0, 30)
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .replace(/\s+/g, '_');
            
        link.download = `IELTS-Practice-Audio_${sanitizedQuestion}.mp4`; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };


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

    const renderAnalysisContent = () => {
        if (isLoading) {
             return <div className="flex flex-col items-center justify-center py-12 px-4 bg-neutral-50 rounded-2xl border border-neutral-100 mt-6">
                <svg className="animate-spin h-8 w-8 text-brand-primary mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span className="text-neutral-600 font-bold tracking-wide">Analyzing your answer with AI...</span>
                <p className="text-sm text-neutral-400 mt-2">This might take a few seconds</p>
            </div>
        }
        if (error) {
            return <div className="mt-6 p-4 bg-rose-50 border border-rose-100 rounded-xl text-center"><p className="text-rose-600 font-bold">{error}</p></div>
        }
        if (analysis) {
            return (
                <div className="space-y-8 mt-6 pt-6 border-t border-neutral-100 animate-fade-in">
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
            );
        }
        return null;
    }


    return (
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm hover:shadow-md transition-all border border-neutral-100 w-full text-left mb-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-brand-primary"></div>
            <div ref={cardContentRef}>
                <div className="flex flex-col mb-6">
                    <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Question</span>
                    <h3 className="text-xl font-display font-bold text-brand-dark leading-snug whitespace-pre-wrap">"{questionText}"</h3>
                </div>
                
                {audioUrl && (
                    <div className="flex items-center gap-4 mb-6 bg-neutral-50 p-4 rounded-2xl border border-neutral-100">
                        <audio ref={audioRef} src={audioUrl} preload="auto" className="hidden"></audio>
                        <button onClick={togglePlayback} className="flex items-center justify-center w-12 h-12 text-white bg-brand-primary rounded-full hover:bg-brand-dark transition-all shadow-md hover:shadow-lg shrink-0">
                            {isPlaying ? <StopIcon className="w-6 h-6"/> : <PlayIcon className="w-6 h-6 ml-1"/>}
                        </button>
                        <div className="flex-1">
                            <p className="text-sm font-bold text-neutral-700">Your Recording</p>
                            <p className="text-xs text-neutral-500">{isPlaying ? 'Playing...' : 'Ready to play'}</p>
                        </div>
                    </div>
                )}
                
                {renderAnalysisContent()}
            </div>
            
             {analysis && !isLoading && !error && (
                <div className="mt-8 pt-6 border-t border-neutral-100 flex flex-col sm:flex-row gap-3 justify-end">
                    {audioUrl && (
                        <button
                            onClick={handleDownloadAudio}
                            className="flex items-center justify-center px-5 py-2.5 text-sm font-bold text-neutral-600 bg-white rounded-xl border border-neutral-200 hover:bg-neutral-50 transition-all shadow-sm hover:shadow"
                        >
                            <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
                            Audio
                        </button>
                    )}
                    <button
                        onClick={handleExportPdf}
                        disabled={isExporting}
                        className="flex items-center justify-center px-5 py-2.5 text-sm font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:bg-neutral-300 transition-all shadow-sm hover:shadow disabled:shadow-none"
                    >
                        <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
                        {isExporting ? 'Exporting...' : 'PDF'}
                    </button>
                    <button
                        onClick={handleExportDocx}
                        disabled={isExporting}
                        className="flex items-center justify-center px-5 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:bg-neutral-300 transition-all shadow-sm hover:shadow disabled:shadow-none"
                    >
                        <DocumentTextIcon className="w-4 h-4 mr-2" />
                        {isExporting ? 'Exporting...' : 'Word'}
                    </button>
                </div>
            )}
        </div>
    );
};