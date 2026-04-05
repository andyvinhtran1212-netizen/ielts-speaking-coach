
import React from 'react';
import type { AnalysisResult } from '../types';
import Loader from './Loader';

interface FeedbackDisplayProps {
  analysisResult: AnalysisResult | null;
  isLoading: boolean;
  loadingMessage?: string;
  originalScript: string;
}

const FeedbackDisplay: React.FC<FeedbackDisplayProps> = ({ analysisResult, isLoading, loadingMessage, originalScript }) => {
  if (isLoading && !analysisResult) {
    return (
        <div className="mt-12 bg-white p-12 rounded-3xl shadow-soft flex flex-col items-center justify-center animate-pulse-soft">
            <div className="w-12 h-12 bg-primary-50 rounded-full flex items-center justify-center mb-6">
              <Loader className="w-6 h-6 text-primary-600" />
            </div>
            <p className="text-lg font-bold text-slate-700">{loadingMessage || 'Analyzing...'}</p>
            <p className="text-sm text-slate-400 mt-2">Gemini is reviewing your proficiency</p>
        </div>
    );
  }

  if (!analysisResult) return null;

  const { keyMetrics, feedback, improvedScript, relevanceFeedback, clarityConcisenessFeedback, answerExpansion } = analysisResult;

  return (
    <div className="mt-12 space-y-10 animate-fade-in-up">
        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Grammar Alerts</span>
                <p className="text-3xl font-black text-slate-800">{keyMetrics.grammarSuggestionsCount}</p>
            </div>
            {keyMetrics.relevanceRating && (
              <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Relevance</span>
                  <p className="text-3xl font-black text-emerald-500">{keyMetrics.relevanceRating}</p>
              </div>
            )}
            {keyMetrics.clarityRating && (
              <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Clarity</span>
                  <p className="text-3xl font-black text-indigo-500">{keyMetrics.clarityRating}</p>
              </div>
            )}
        </div>
        
        {/* Script Transformation */}
        <div className="bg-slate-900 rounded-[2.5rem] p-8 md:p-12 text-white shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary-600/10 rounded-full blur-3xl -mr-32 -mt-32"></div>
            <div className="relative z-10 space-y-10">
              <div className="flex flex-col md:flex-row gap-10">
                  <div className="flex-1 space-y-4">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-rose-500 rounded-full"></span>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Initial Draft</h4>
                      </div>
                      <p className="text-slate-300 leading-relaxed font-medium">"{originalScript}"</p>
                  </div>
                  
                  <div className="hidden md:flex items-center text-slate-700">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                  </div>

                  <div className="flex-1 space-y-6">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                          <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-widest">Polished Version</h4>
                        </div>
                      </div>
                      <p className="text-white text-xl leading-relaxed font-bold font-sans">"{improvedScript}"</p>
                  </div>
              </div>
            </div>
        </div>

        {/* Detailed Feedback Table */}
        {feedback.length > 0 && (
            <div className="bg-white rounded-3xl shadow-soft border border-slate-100 overflow-hidden">
                <div className="p-6 bg-slate-50 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800">Grammar & Phrasing Refinements</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full">
                        <thead className="bg-slate-50/50">
                            <tr>
                                <th className="text-left py-4 px-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Draft</th>
                                <th className="text-left py-4 px-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Polished</th>
                                <th className="text-left py-4 px-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Insight</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {feedback.map((item, index) => (
                                <tr key={index} className="hover:bg-slate-50/30 transition">
                                    <td className="py-6 px-6 align-top">
                                        <span className="inline-block px-2 py-1 bg-rose-50 text-rose-600 rounded-md text-sm font-bold">{item.original}</span>
                                    </td>
                                    <td className="py-6 px-6 align-top">
                                        <span className="inline-block px-2 py-1 bg-emerald-50 text-emerald-600 rounded-md text-sm font-bold">{item.correction}</span>
                                    </td>
                                    <td className="py-6 px-6 text-slate-500 text-sm leading-relaxed align-top">{item.explanation_vi}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
    </div>
  );
};

export default FeedbackDisplay;
