import React from 'react';
import { unlockAudioContext } from '../utils/audioContext';
import { PencilSquareIcon, TargetIcon } from './Icons';

interface ModeSelectionProps {
  onSelectCustom: () => void;
  onSelectPartPractice: () => void;
}

const ModeCard = ({ icon, title, description, onClick }: { icon: React.ReactNode, title: string, description: string, onClick: () => void }) => (
  <div
    onClick={onClick}
    className="group bg-white hover:shadow-xl hover:-translate-y-1 transform transition-all duration-300 cursor-pointer rounded-3xl p-8 border border-neutral-100 flex flex-col items-center text-center relative overflow-hidden"
  >
    <div className="absolute inset-0 bg-gradient-to-br from-brand-light to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
    <div className="mb-6 w-16 h-16 bg-brand-light rounded-2xl flex items-center justify-center text-brand-primary group-hover:scale-110 transition-transform duration-300 relative z-10">
      {icon}
    </div>
    <h2 className="text-2xl font-display font-bold text-brand-dark mb-3 relative z-10">{title}</h2>
    <p className="text-neutral-500 text-sm leading-relaxed relative z-10">
      {description}
    </p>
  </div>
);

export const ModeSelection: React.FC<ModeSelectionProps> = ({ onSelectCustom, onSelectPartPractice }) => {

  const handleSelect = (callback: () => void) => {
    unlockAudioContext(); // Unlock audio context on user gesture
    callback();
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-brand-light p-4">
      <div className="w-full max-w-5xl p-8 md:p-12 space-y-10">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl font-display font-extrabold text-brand-dark tracking-tight">Choose Your Path</h1>
          <p className="mt-4 text-neutral-500 text-lg max-w-2xl mx-auto">Select how you'd like to prepare for your test today. Both modes provide detailed AI feedback.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <ModeCard
            onClick={() => handleSelect(onSelectCustom)}
            icon={<PencilSquareIcon className="w-8 h-8" />}
            title="Full Test Simulation"
            description="Experience a complete IELTS speaking test under timed conditions with a comprehensive final report."
          />
          <ModeCard
            onClick={() => handleSelect(onSelectPartPractice)}
            icon={<TargetIcon className="w-8 h-8" />}
            title="Part-by-Part Practice"
            description="Focus on specific parts of the test with instant, detailed feedback after every single question."
          />
        </div>
      </div>
    </div>
  );
};