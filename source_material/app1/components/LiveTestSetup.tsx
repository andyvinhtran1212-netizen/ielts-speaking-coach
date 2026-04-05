import React, { useState } from 'react';

interface LiveTestSetupProps {
    onStart: (part2Topic: string) => void;
    onBack: () => void;
}

export const LiveTestSetup: React.FC<LiveTestSetupProps> = ({ onStart, onBack }) => {
    const [topic, setTopic] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = () => {
        if (topic.trim() === '') {
            setError('Please provide a topic for Part 2.');
            return;
        }
        setError('');
        onStart(topic.trim());
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
            <div className="w-full max-w-lg p-8 space-y-6 bg-white rounded-2xl shadow-lg">
                <div className="text-center">
                    <h1 className="text-3xl font-extrabold text-gray-900">Live AI Conversation Setup</h1>
                    <p className="mt-2 text-gray-600">To personalize your test, please provide a topic for the Part 2 cue card.</p>
                </div>

                <div>
                    <label htmlFor="part2-topic" className="text-lg font-semibold text-gray-800 mb-2 block">Part 2 Topic</label>
                    <input
                        id="part2-topic"
                        type="text"
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
                        placeholder="e.g., A memorable trip, an interesting hobby"
                        className="appearance-none rounded-lg relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary sm:text-sm"
                    />
                </div>
                
                {error && <p className="text-sm text-center text-red-600">{error}</p>}

                <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t">
                    <button
                        onClick={onBack}
                        className="w-full flex justify-center py-3 px-4 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-brand-primary hover:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary"
                    >
                        Start Live Test
                    </button>
                </div>
            </div>
        </div>
    );
};
