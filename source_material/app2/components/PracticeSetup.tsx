import React from 'react';

const PartIcon: React.FC<{ part: number }> = ({ part }) => (
    <div className="w-10 h-10 flex items-center justify-center bg-primary text-white rounded-full font-bold text-xl mb-4">
        {part}
    </div>
);

const partDetails = {
    part1: { title: "Part 1", description: "Short, personal questions.", time: "45 seconds" },
    part2: { title: "Part 2", description: "Monologue on a given topic.", time: "2 minutes" },
    part3: { title: "Part 3", description: "Abstract discussion questions.", time: "1 minute 30 seconds" },
};

interface PracticeSetupProps {
  onSetupComplete: (part: 'part1' | 'part2' | 'part3') => void;
}

const PracticeSetup: React.FC<PracticeSetupProps> = ({ onSetupComplete }) => {

  const cardClasses = "flex flex-col items-center justify-start text-center p-6 border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all duration-200 h-full cursor-pointer border-gray-200 hover:border-primary/50 hover:bg-primary/5";

  return (
    <div className="w-full max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-lg text-center animate-fade-in">
        <h2 className="text-3xl font-bold text-dark mb-2">IELTS Speaking Practice</h2>
        <p className="text-secondary mb-8 text-lg">Which part of the test are you practicing for?</p>

        {/* Test Part Selection */}
        <div className="mb-2">
             <h3 className="text-xl font-semibold text-dark mb-4 text-left">Select a test part to begin</h3>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div 
                    onClick={() => onSetupComplete('part1')} 
                    className={cardClasses} 
                    role="button" 
                    tabIndex={0} 
                    aria-label="Start practice for Part 1"
                >
                    <PartIcon part={1} />
                    <h4 className="text-lg font-semibold text-dark">{partDetails.part1.title}</h4>
                    <p className="text-secondary mt-1 text-sm flex-grow">{partDetails.part1.description}</p>
                    <p className="text-sm font-semibold text-primary mt-4">Max {partDetails.part1.time}</p>
                </div>
                <div 
                    onClick={() => onSetupComplete('part2')} 
                    className={cardClasses} 
                    role="button" 
                    tabIndex={0} 
                    aria-label="Start practice for Part 2"
                >
                    <PartIcon part={2} />
                    <h4 className="text-lg font-semibold text-dark">{partDetails.part2.title}</h4>
                    <p className="text-secondary mt-1 text-sm flex-grow">{partDetails.part2.description}</p>
                    <p className="text-sm font-semibold text-primary mt-4">Max {partDetails.part2.time}</p>
                </div>
                <div 
                    onClick={() => onSetupComplete('part3')} 
                    className={cardClasses} 
                    role="button" 
                    tabIndex={0} 
                    aria-label="Start practice for Part 3"
                >
                    <PartIcon part={3} />
                    <h4 className="text-lg font-semibold text-dark">{partDetails.part3.title}</h4>
                    <p className="text-secondary mt-1 text-sm flex-grow">{partDetails.part3.description}</p>
                    <p className="text-sm font-semibold text-primary mt-4">Max {partDetails.part3.time}</p>
                </div>
            </div>
        </div>
    </div>
  );
};

export default PracticeSetup;