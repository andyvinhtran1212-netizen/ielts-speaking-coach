

import React from 'react';

interface CueCardDisplayProps {
    topic: string;
    instruction: string;
    points: string[];
    className?: string;
}

export const CueCardDisplay: React.FC<CueCardDisplayProps> = ({ topic, instruction, points, className }) => {
    return (
        <div className={`bg-white p-8 sm:p-10 rounded-3xl shadow-lg border border-neutral-100 w-full h-full flex flex-col relative overflow-hidden ${className}`}>
            <div className="absolute top-0 left-0 w-1.5 h-full bg-brand-primary"></div>
            <div className="mb-8 pb-6 border-b border-neutral-100">
                <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-3 flex items-center">
                    <svg className="w-4 h-4 mr-1.5 text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>
                    Cue Card
                </p>
                <h3 className="font-display font-bold text-2xl sm:text-3xl text-brand-dark leading-tight">{topic}</h3>
            </div>
            <div className="flex-grow flex flex-col">
                <p className="text-neutral-700 text-lg leading-relaxed mb-6">{instruction}</p>
                <div className="bg-neutral-50 rounded-2xl p-6 sm:p-8 border border-neutral-100 mt-auto">
                    <p className="text-sm font-bold text-neutral-500 uppercase tracking-wider mb-5 flex items-center">
                        <svg className="w-4 h-4 mr-2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        You should say:
                    </p>
                    {points.length > 0 && (
                        <ul className="space-y-4">
                            {points.map((point, index) => (
                                <li key={index} className="flex items-start text-neutral-700">
                                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-light text-brand-primary flex items-center justify-center text-sm font-bold mr-4 mt-0.5 shadow-sm border border-brand-primary/10">
                                        {index + 1}
                                    </span>
                                    <span className="leading-relaxed text-base">{point}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};