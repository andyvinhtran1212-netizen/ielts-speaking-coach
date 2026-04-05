import React, { useState, useRef, useMemo } from 'react';
import type { AnalysisResult, RecordedAnswer } from '../types';
// fix: Corrected import from IELTS_BAND_DESCRIPTIONS to IELTS_BAND_DESCRIPTORS
import { IELTS_BAND_DESCRIPTORS } from '../constants';
import { ExtraAnalysisView } from './ExtraAnalysisView';
import { ThumbsUpIcon, LightBulbIcon, TargetIcon, ArrowDownTrayIcon, DocumentTextIcon } from './Icons';


// Use jsPDF and html2canvas from window object as they are loaded via CDN
declare global {
    interface Window {
        jspdf: any;
        html2canvas: any;
        docx: any;
    }
}

interface ResultsViewProps {
  result: AnalysisResult;
  structuredAnswers: RecordedAnswer[];
  onRetakeTest: () => void;
  testDuration: number; // in seconds
}

const ScoreCircle: React.FC<{ score: number }> = ({ score }) => (
    <div className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-full flex items-center justify-center bg-white shadow-inner shrink-0 border-[8px] border-neutral-50">
        <svg className="absolute top-0 left-0 w-full h-full -rotate-90 transform" viewBox="0 0 36 36">
            <path className="text-neutral-100" strokeWidth="3" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path className="text-brand-primary transition-all duration-1000 ease-out" strokeWidth="3" strokeDasharray={`${(score / 9) * 100}, 100`} strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
        </svg>
        <div className="flex flex-col items-center justify-center">
            <span className="text-5xl sm:text-6xl font-display font-extrabold text-brand-dark tracking-tighter">{score.toFixed(1)}</span>
            <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest mt-1">Band</span>
        </div>
    </div>
);

const CriteriaCard: React.FC<{ title: keyof typeof IELTS_BAND_DESCRIPTORS; score: number; feedback: string; }> = ({ title, score, feedback }) => {
  const formattedTitle = title.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
  return (
    <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-neutral-100 transition-all hover:shadow-md group relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1.5 h-full bg-neutral-200 group-hover:bg-brand-primary transition-colors duration-300"></div>
      <div className="flex justify-between items-start mb-5 pl-2">
        <div className="flex-grow pr-4">
          <h3 className="text-xl font-display font-bold text-brand-dark">{formattedTitle}</h3>
        </div>
        <span className="text-2xl font-display font-extrabold text-brand-primary px-5 py-2 bg-brand-light rounded-2xl ml-auto shrink-0 border border-brand-primary/10 shadow-sm">{score.toFixed(1)}</span>
      </div>

      <div className="border-t border-neutral-100 pt-5 pl-2">
        <p className="text-neutral-800 font-bold mb-3 text-xs uppercase tracking-widest flex items-center">
            <svg className="w-4 h-4 mr-1.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
            Feedback
        </p>
        <p className="text-neutral-600 mb-5 whitespace-pre-wrap text-base leading-relaxed">{feedback}</p>
        
        <details className="mt-5">
          <summary className="text-sm font-bold text-brand-secondary hover:text-brand-primary cursor-pointer list-none flex items-center transition-colors w-max">
            <span>View Band Descriptors</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1.5 transform group-open:rotate-180 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="mt-5 space-y-3 text-sm text-neutral-600 max-h-60 overflow-y-auto border-t border-neutral-100 pt-5 custom-scrollbar pr-3">
            {Object.entries(IELTS_BAND_DESCRIPTORS[title]).reverse().map(([band, desc]: [string, string]) => (
              <div key={band} className={`p-4 rounded-2xl transition-colors ${Math.round(score) === parseInt(band, 10) ? 'bg-brand-light border border-brand-primary/20 shadow-sm' : 'hover:bg-neutral-50 border border-transparent'}`}>
                <span className="font-bold text-brand-dark text-base block mb-1.5">Band {band}</span> {desc}
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
};

const TakeawayCard: React.FC<{ icon: React.ReactNode; title: string; subtitle: string; content: string; }> = ({ icon, title, subtitle, content }) => (
    <div className="bg-white p-6 rounded-3xl border border-neutral-100 shadow-sm flex items-start gap-5 transition-all hover:shadow-md group">
        <div className="shrink-0 pt-1">
            <div className="w-12 h-12 rounded-2xl bg-neutral-50 flex items-center justify-center border border-neutral-100 group-hover:scale-110 transition-transform duration-300 shadow-sm">
                {icon}
            </div>
        </div>
        <div>
            <h3 className="font-bold text-neutral-400 text-xs uppercase tracking-widest mb-1.5">{title}</h3>
            <p className="text-lg text-brand-dark font-display font-bold mb-2 leading-tight">{subtitle}</p>
            <p className="text-base text-neutral-600 whitespace-pre-wrap leading-relaxed">{content}</p>
        </div>
    </div>
);


export const ResultsView: React.FC<ResultsViewProps> = ({ result, structuredAnswers, onRetakeTest }) => {
    const [isExporting, setIsExporting] = useState(false);
    const resultsContentRef = useRef<HTMLDivElement>(null);

    const handleExportPdf = async () => {
        const { jsPDF } = window.jspdf;
        const input = resultsContentRef.current;
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
                backgroundColor: '#F5F7FA',
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
            
            const imgProps = pdf.getImageProperties(imgData);
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

            const date = new Date().toISOString().split('T')[0];
            pdf.save(`IELTS-Speaking-Report_${date}.pdf`);
        } catch (err) {
            console.error("Error exporting to PDF", err);
            alert('An error occurred while exporting the PDF. Please try again.');
        } finally {
            document.body.removeChild(clone);
            setIsExporting(false);
        }
    };

    const performanceMetrics = useMemo(() => {
        const criteria = [
            { key: 'fluency', name: 'Fluency', score: result.fluency.score, feedback: result.fluency.feedback },
            { key: 'lexicalResource', name: 'Lexical Resource', score: result.lexicalResource.score, feedback: result.lexicalResource.feedback },
            { key: 'grammar', name: 'Grammar', score: result.grammar.score, feedback: result.grammar.feedback },
            { key: 'pronunciation', name: 'Pronunciation', score: result.pronunciation.score, feedback: result.pronunciation.feedback }
        ];
        
        const strength = criteria.reduce((prev, current) => (prev.score > current.score) ? prev : current);
        const weakness = criteria.reduce((prev, current) => (prev.score < current.score) ? prev : current);

        return { strength, weakness };
    }, [result]);
    
    const handleExportDocx = async () => {
        setIsExporting(true);
        const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;

        const createHeading = (text: string, level: any = HeadingLevel.HEADING_1) => new Paragraph({ text, heading: level, spacing: { after: 200 } });
        const createSubheading = (text: string) => new Paragraph({ children: [new TextRun({ text, bold: true })], spacing: { after: 100 } });
        const createPara = (text: string) => new Paragraph({ text, spacing: { after: 200 } });

        const criteria = [
            { title: "Fluency & Coherence", score: result.fluency.score, feedback: result.fluency.feedback },
            { title: "Lexical Resource", score: result.lexicalResource.score, feedback: result.lexicalResource.feedback },
            { title: "Grammatical Range & Accuracy", score: result.grammar.score, feedback: result.grammar.feedback },
            { title: "Pronunciation", score: result.pronunciation.score, feedback: result.pronunciation.feedback }
        ];

        const transcriptParagraphs = structuredAnswers.flatMap(answer => [
            createSubheading(`Examiner (${answer.part} - ${answer.topic}):`),
            new Paragraph({ text: answer.question, indent: { left: 720 }, spacing: { after: 100 } }),
            createSubheading(`Student:`),
            new Paragraph({ text: answer.transcript || '(No transcript available)', indent: { left: 720 }, spacing: { after: 400 } }),
        ]);

        const doc = new Document({
            sections: [{
                children: [
                    new Paragraph({ text: "IELTS Speaking Performance Report", heading: HeadingLevel.TITLE, alignment: 'center' }),
                    createPara(`Generated on: ${new Date().toLocaleDateString()}`),
                    
                    createHeading("Overall Performance"),
                    createSubheading("Overall Band Score"),
                    createPara(`${result.overallBandScore.toFixed(1)}`),
                    
                    createHeading("Key Takeaways"),
                    createSubheading(`Your Greatest Strength: ${performanceMetrics.strength.name}`),
                    createPara(performanceMetrics.strength.feedback),
                    createSubheading(`Your Top Priority: Focus on ${performanceMetrics.weakness.name}`),
                    createPara(result.summary),
                    createSubheading("Golden Tip"),
                    createPara(result.goldenTip),

                    createHeading("Criteria Breakdown"),
                    ...criteria.flatMap(c => [
                        createSubheading(`${c.title}: ${c.score.toFixed(1)}`),
                        createPara(c.feedback),
                    ]),

                    createHeading("Full Test Transcript"),
                    ...transcriptParagraphs,
                ],
            }],
        });
        
        try {
            const blob = await Packer.toBlob(doc);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const date = new Date().toISOString().split('T')[0];
            a.download = `IELTS-Speaking-Report_${date}.docx`;
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


  return (
    <div className="min-h-screen bg-brand-light p-4 sm:p-6 lg:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-6">
           <div>
              <h1 className="text-4xl lg:text-5xl font-display font-extrabold text-brand-dark tracking-tight">Performance Report</h1>
              <p className="text-neutral-500 mt-2 text-lg">Generated on {new Date().toLocaleDateString()}</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <button onClick={handleExportPdf} disabled={isExporting} className="flex items-center px-5 py-2.5 text-sm font-bold text-white bg-brand-dark rounded-xl hover:bg-neutral-800 transition-all shadow-sm hover:shadow-md disabled:bg-neutral-300 disabled:shadow-none">
              <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
              {isExporting ? 'Exporting...' : 'Export PDF'}
            </button>
             <button onClick={handleExportDocx} disabled={isExporting} className="flex items-center px-5 py-2.5 text-sm font-bold text-brand-dark bg-white border border-neutral-200 rounded-xl hover:bg-neutral-50 transition-all shadow-sm hover:shadow-md disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none">
              <DocumentTextIcon className="w-4 h-4 mr-2" />
              {isExporting ? 'Exporting...' : 'Export DOCX'}
            </button>
            <button onClick={onRetakeTest} className="px-5 py-2.5 text-sm font-bold text-white bg-brand-primary rounded-xl hover:bg-brand-secondary transition-all shadow-sm hover:shadow-md">Take Another Test</button>
          </div>
        </div>
        
        <div ref={resultsContentRef} className="bg-brand-light">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
              {/* --- LEFT COLUMN (At a Glance) --- */}
              <aside className="lg:col-span-2 space-y-8">
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-neutral-100 text-center relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-secondary to-brand-primary"></div>
                      <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-6">Overall Band Score</p>
                      <div className="flex justify-center mb-6">
                          <ScoreCircle score={result.overallBandScore} />
                      </div>
                      <p className="text-neutral-500 max-w-md mx-auto text-sm leading-relaxed">This score is an average of the four criteria below, reflecting your overall performance.</p>
                  </div>

                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-neutral-100">
                      <h2 className="text-2xl font-display font-bold text-brand-dark mb-6">Key Takeaways</h2>
                      <div className="space-y-4">
                           <TakeawayCard
                                icon={<ThumbsUpIcon className="w-6 h-6 text-emerald-500" />}
                                title="Your Greatest Strength"
                                subtitle={performanceMetrics.strength.name}
                                content={performanceMetrics.strength.feedback}
                            />
                            <TakeawayCard
                                icon={<TargetIcon className="w-6 h-6 text-rose-500" />}
                                title="Your Top Priority"
                                subtitle={`Focus on ${performanceMetrics.weakness.name}`}
                                content={result.summary}
                            />
                            <TakeawayCard
                                icon={<LightBulbIcon className="w-6 h-6 text-amber-500" />}
                                title="Golden Tip"
                                subtitle="One actionable piece of advice"
                                content={result.goldenTip}
                            />
                      </div>
                  </div>

                   <div className="space-y-4">
                       <h2 className="text-2xl font-display font-bold text-brand-dark mb-6 px-2">Criteria Breakdown</h2>
                       <CriteriaCard title="fluency" score={result.fluency.score} feedback={result.fluency.feedback} />
                       <CriteriaCard title="lexicalResource" score={result.lexicalResource.score} feedback={result.lexicalResource.feedback} />
                       <CriteriaCard title="grammar" score={result.grammar.score} feedback={result.grammar.feedback} />
                       <CriteriaCard title="pronunciation" score={result.pronunciation.score} feedback={result.pronunciation.feedback} />
                   </div>
              </aside>

              {/* --- RIGHT COLUMN (Deep Dive) --- */}
              <main className="lg:col-span-3">
                  <div className="bg-white p-8 rounded-3xl shadow-sm border border-neutral-100 h-full">
                      <div className="mb-8 border-b border-neutral-100 pb-6">
                          <h2 className="text-3xl font-display font-bold text-brand-dark mb-3">Transcript & Detailed Analysis</h2>
                          <p className="text-neutral-500 text-lg leading-relaxed">
                              Review your full test transcript. Click the button below each answer to get detailed, AI-powered feedback and a sample response.
                          </p>
                      </div>
                      <ExtraAnalysisView structuredAnswers={structuredAnswers} />
                  </div>
              </main>
          </div>
        </div>
      </div>
    </div>
  );
};