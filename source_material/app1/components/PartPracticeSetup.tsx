import React, { useState } from 'react';
import { PlusIcon, TrashIcon } from './Icons';
import { PracticePart } from '../types';

interface PartPracticeSetupProps {
    onStartPractice: (part: PracticePart, topics: { part1: string[], part2: string[], part3: string[] }) => void;
    onBack: () => void;
    initialTopics: { part1: string[], part2: string[], part3: string[] } | null;
}

const TopicManager: React.FC<{
    title: string;
    topics: string[];
    setTopics: React.Dispatch<React.SetStateAction<string[]>>;
    onStart: () => void;
}> = ({ title, topics, setTopics, onStart }) => {
    const [currentInput, setCurrentInput] = useState('');

    const handleAddTopics = () => {
        if (currentInput.trim()) {
            const newTopics = currentInput
                .split(/[,\n]+/)
                .map(topic => topic.trim())
                .filter(topic => topic && !topics.includes(topic));
            
            if (newTopics.length > 0) {
                setTopics([...topics, ...newTopics]);
            }
            setCurrentInput('');
        }
    };

    const handleRemoveTopic = (topicToRemove: string) => {
        setTopics(topics.filter(topic => topic !== topicToRemove));
    };
    
    return (
        <div className="p-6 sm:p-8 bg-white rounded-3xl shadow-xl border border-neutral-100 mb-8 transition-all hover:shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
                <div>
                    <h2 className="text-2xl font-display font-bold text-brand-dark">{title}</h2>
                    <p className="text-sm text-neutral-500 mt-1">Add topics to your library. The app will pick one randomly.</p>
                </div>
                <span className="text-xs font-semibold bg-brand-light text-brand-primary px-3 py-1.5 rounded-full shrink-0 self-start sm:self-auto">{topics.length} topics</span>
            </div>
            
            <div className="space-y-2 mb-6 max-h-40 overflow-y-auto pr-2 custom-scrollbar bg-neutral-50/50 p-4 rounded-2xl border border-neutral-100">
                {topics.length > 0 ? topics.map(topic => (
                    <div key={topic} className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm border border-neutral-100 group hover:border-brand-primary/30 transition-colors">
                        <span className="text-neutral-700 text-sm font-medium">{topic}</span>
                        <button onClick={() => handleRemoveTopic(topic)} className="text-neutral-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100">
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>
                )) : <div className="text-center py-8 text-neutral-400 text-sm border-2 border-dashed border-neutral-200 rounded-xl">Your library is empty. Add some topics!</div>}
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <textarea
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    placeholder="Add topics, separated by commas or newlines"
                    className="flex-grow p-3.5 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary text-sm transition-all bg-white resize-none"
                    rows={2}
                />
                <button onClick={handleAddTopics} className="px-5 py-3.5 text-brand-primary bg-brand-light hover:bg-brand-primary hover:text-white rounded-xl transition-colors font-semibold text-sm flex items-center justify-center shrink-0 h-fit sm:h-auto">
                    <PlusIcon className="w-4 h-4 mr-1.5" /> Add
                </button>
            </div>
            
            <button
                onClick={onStart}
                disabled={topics.length === 0}
                className="w-full flex justify-center py-3.5 px-4 border border-transparent text-base font-semibold rounded-xl text-white bg-brand-primary hover:bg-brand-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary disabled:bg-neutral-300 disabled:text-neutral-500 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg disabled:shadow-none"
            >
                Start {title} Practice
            </button>
        </div>
    );
}

export const PartPracticeSetup: React.FC<PartPracticeSetupProps> = ({ onStartPractice, onBack, initialTopics }) => {
    const [part1Topics, setPart1Topics] = useState<string[]>(initialTopics?.part1 || []);
    const [part2Topics, setPart2Topics] = useState<string[]>(initialTopics?.part2 || []);
    const [part3Topics, setPart3Topics] = useState<string[]>(initialTopics?.part3 || []);
    
    const handleStart = (part: PracticePart) => {
        onStartPractice(part, { part1: part1Topics, part2: part2Topics, part3: part3Topics });
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-brand-light p-4 font-sans py-12">
            <div className="w-full max-w-3xl space-y-8">
                <div className="text-center mb-10">
                    <h1 className="text-4xl sm:text-5xl font-display font-extrabold text-brand-dark tracking-tight">Part-by-Part Practice</h1>
                    <p className="mt-4 text-neutral-500 text-lg max-w-2xl mx-auto">Focus your training by practicing one part of the test at a time with instant feedback.</p>
                </div>

                <TopicManager title="Part 1" topics={part1Topics} setTopics={setPart1Topics} onStart={() => handleStart(PracticePart.Part1)} />
                <TopicManager title="Part 2" topics={part2Topics} setTopics={setPart2Topics} onStart={() => handleStart(PracticePart.Part2)} />
                <TopicManager title="Part 3" topics={part3Topics} setTopics={setPart3Topics} onStart={() => handleStart(PracticePart.Part3)} />

                <div className="pt-6">
                    <button
                        onClick={onBack}
                        className="w-full sm:w-auto mx-auto flex justify-center py-3.5 px-8 border border-neutral-200 text-base font-semibold rounded-xl text-neutral-700 bg-white hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-neutral-200 transition-all shadow-sm"
                    >
                        Back to Mode Selection
                    </button>
                </div>
            </div>
        </div>
    );
};
