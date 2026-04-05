import React, { useState } from 'react';
import { PlusIcon, TrashIcon } from './Icons';

interface CustomTestSetupProps {
    onStartTest: (part1Topics: string[], part2Topics: string[]) => void;
    onBack: () => void;
}

const TopicItem: React.FC<{ topic: string; onRemove: () => void; }> = ({ topic, onRemove }) => (
    <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm border border-neutral-100 group hover:border-brand-primary/30 transition-colors">
        <span className="text-neutral-700 text-sm font-medium">{topic}</span>
        <button onClick={onRemove} className="text-neutral-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100">
            <TrashIcon className="w-4 h-4" />
        </button>
    </div>
);

export const CustomTestSetup: React.FC<CustomTestSetupProps> = ({ onStartTest, onBack }) => {
    const [part1Topics, setPart1Topics] = useState<string[]>([]);
    const [currentPart1Input, setCurrentPart1Input] = useState('');

    const [part2Topics, setPart2Topics] = useState<string[]>([]);
    const [currentPart2Input, setCurrentPart2Input] = useState('');

    const [error, setError] = useState('');
    
    const handleAddPart1Topics = () => {
        if (!currentPart1Input.trim()) return;

        const newTopicStrings = currentPart1Input
            .split(/[,\n]+/)
            .map(topic => topic.trim())
            .filter(topic => topic && !part1Topics.includes(topic));
        
        if (newTopicStrings.length > 0) {
            setPart1Topics(prev => [...prev, ...newTopicStrings]);
        }
        setCurrentPart1Input('');
    };

    const handleAddPart2Topics = () => {
        if (!currentPart2Input.trim()) return;

        const newTopicStrings = currentPart2Input
            .split(/[,\n]+/)
            .map(topic => topic.trim())
            .filter(topic => topic && !part2Topics.includes(topic));

        if (newTopicStrings.length > 0) {
            setPart2Topics(prev => [...prev, ...newTopicStrings]);
        }
        setCurrentPart2Input('');
    };

    const handleRemoveTopic = (topicToRemove: string, part: 'part1' | 'part2') => {
        if (part === 'part1') {
            setPart1Topics(prev => prev.filter(t => t !== topicToRemove));
        } else {
             setPart2Topics(prev => prev.filter(t => t !== topicToRemove));
        }
    };

    const handleSubmit = () => {
        if (part1Topics.length < 3 || part2Topics.length < 1) {
            setError(`Please provide at least 3 Part 1 topics and 1 Part 2 topic. (Current: ${part1Topics.length} P1, ${part2Topics.length} P2)`);
            return;
        }
        setError('');
        onStartTest(part1Topics, part2Topics);
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-brand-light p-4 font-sans">
            <div className="w-full max-w-3xl p-8 sm:p-10 space-y-10 bg-white rounded-3xl shadow-xl border border-neutral-100">
                <div className="text-center">
                    <h1 className="text-3xl sm:text-4xl font-display font-bold text-brand-dark tracking-tight">Create a Custom Test</h1>
                    <p className="mt-3 text-neutral-500 text-sm sm:text-base max-w-xl mx-auto leading-relaxed">Build your topic library. The app will randomly select <strong className="text-brand-primary">3 Part 1 topics</strong> and <strong className="text-brand-primary">1 Part 2 topic</strong> to create a unique test each time.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Part 1 Topics */}
                    <div className="space-y-4 bg-neutral-50/50 p-5 rounded-2xl border border-neutral-100">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-display font-semibold text-neutral-800">Part 1 Topics</h2>
                            <span className="text-xs font-medium bg-brand-light text-brand-primary px-2.5 py-1 rounded-full">{part1Topics.length} added</span>
                        </div>
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                            {part1Topics.map((topic) => (
                                <TopicItem key={topic} topic={topic} onRemove={() => handleRemoveTopic(topic, 'part1')} />
                            ))}
                            {part1Topics.length === 0 && (
                                <div className="text-center py-6 text-neutral-400 text-sm border-2 border-dashed border-neutral-200 rounded-xl">No topics added yet</div>
                            )}
                        </div>
                        <div className="flex flex-col space-y-3 pt-2">
                            <textarea
                                value={currentPart1Input}
                                onChange={(e) => setCurrentPart1Input(e.target.value)}
                                placeholder="Add topics, separated by commas or newlines"
                                className="w-full p-3.5 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary text-sm transition-all bg-white resize-none"
                                rows={3}
                            />
                            <button onClick={handleAddPart1Topics} className="w-full px-4 py-2.5 text-brand-primary bg-brand-light hover:bg-brand-primary hover:text-white rounded-xl transition-colors font-semibold text-sm flex items-center justify-center">
                                <PlusIcon className="w-4 h-4 mr-1.5" /> Add to Part 1
                            </button>
                        </div>
                    </div>

                    {/* Part 2 Topic */}
                    <div className="space-y-4 bg-neutral-50/50 p-5 rounded-2xl border border-neutral-100">
                         <div className="flex items-center justify-between">
                            <h2 className="text-lg font-display font-semibold text-neutral-800">Part 2 Topics</h2>
                            <span className="text-xs font-medium bg-brand-light text-brand-primary px-2.5 py-1 rounded-full">{part2Topics.length} added</span>
                        </div>
                         <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                             {part2Topics.map((topic) => (
                                <TopicItem key={topic} topic={topic} onRemove={() => handleRemoveTopic(topic, 'part2')} />
                            ))}
                            {part2Topics.length === 0 && (
                                <div className="text-center py-6 text-neutral-400 text-sm border-2 border-dashed border-neutral-200 rounded-xl">No topics added yet</div>
                            )}
                        </div>
                         <div className="flex flex-col space-y-3 pt-2">
                            <textarea
                                value={currentPart2Input}
                                onChange={(e) => setCurrentPart2Input(e.target.value)}
                                placeholder="Add topics, separated by commas or newlines"
                                className="w-full p-3.5 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary text-sm transition-all bg-white resize-none"
                                rows={3}
                            />
                            <button onClick={handleAddPart2Topics} className="w-full px-4 py-2.5 text-brand-primary bg-brand-light hover:bg-brand-primary hover:text-white rounded-xl transition-colors font-semibold text-sm flex items-center justify-center">
                                <PlusIcon className="w-4 h-4 mr-1.5" /> Add to Part 2
                            </button>
                        </div>
                    </div>
                </div>
                
                {error && <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium text-center border border-red-100">{error}</div>}

                <div className="flex flex-col sm:flex-row gap-4 pt-6">
                    <button
                        onClick={onBack}
                        className="w-full sm:w-1/3 flex justify-center py-3.5 px-4 border border-neutral-200 text-base font-semibold rounded-xl text-neutral-700 bg-white hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-neutral-200 transition-all"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="w-full sm:w-2/3 flex justify-center py-3.5 px-4 border border-transparent text-base font-semibold rounded-xl text-white bg-brand-primary hover:bg-brand-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary transition-all shadow-md hover:shadow-lg"
                    >
                        Generate & Start Test
                    </button>
                </div>
            </div>
        </div>
    );
};
