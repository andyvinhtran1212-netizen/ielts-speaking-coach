import React, { useState } from 'react';
import { unlockAudioContext } from '../utils/audioContext';
import { PencilSquareIcon, TargetIcon } from './Icons';

interface ModeratorViewProps {
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

const TabContent: React.FC<ModeratorViewProps> = ({ onSelectCustom, onSelectPartPractice }) => {
  const handleSelect = (callback: () => void) => {
    unlockAudioContext();
    callback();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 max-w-4xl mx-auto">
      <ModeCard
        onClick={() => handleSelect(onSelectCustom)}
        icon={<PencilSquareIcon className="w-8 h-8" />}
        title="Full Test Simulation"
        description="Build a full test simulation using your own topic library for a tailored practice session."
      />
      <ModeCard
        onClick={() => handleSelect(onSelectPartPractice)}
        icon={<TargetIcon className="w-8 h-8" />}
        title="Part-by-Part Practice"
        description="Focus on one part at a time with instant, detailed feedback after every question."
      />
    </div>
  );
};

export const ModeratorView: React.FC<ModeratorViewProps> = ({ onSelectCustom, onSelectPartPractice }) => {
  const [activeTab, setActiveTab] = useState<'common' | 'developer'>('common');

  return (
    <div className="flex items-center justify-center min-h-screen bg-brand-light p-4">
      <div className="w-full max-w-5xl p-8 md:p-12 space-y-10 bg-white rounded-3xl shadow-xl border border-neutral-100 text-center">
        <div>
          <h1 className="text-4xl md:text-5xl font-display font-extrabold text-brand-dark tracking-tight">Moderator Panel</h1>
          <p className="mt-4 text-neutral-500 text-lg max-w-2xl mx-auto">Select a user view and practice mode to begin.</p>
        </div>
        
        <div className="flex justify-center border-b border-neutral-100 mb-8">
          <button
            onClick={() => setActiveTab('common')}
            className={`px-8 py-4 font-semibold transition-all duration-200 text-sm uppercase tracking-wider ${activeTab === 'common' ? 'border-b-2 border-brand-primary text-brand-primary' : 'text-neutral-400 hover:text-brand-dark'}`}
          >
            Common Users
          </button>
          <button
            onClick={() => setActiveTab('developer')}
            className={`px-8 py-4 font-semibold transition-all duration-200 text-sm uppercase tracking-wider ${activeTab === 'developer' ? 'border-b-2 border-brand-primary text-brand-primary' : 'text-neutral-400 hover:text-brand-dark'}`}
          >
            Developers
          </button>
        </div>

        <div>
          {activeTab === 'common' && <TabContent onSelectCustom={onSelectCustom} onSelectPartPractice={onSelectPartPractice} />}
          {activeTab === 'developer' && <TabContent onSelectCustom={onSelectCustom} onSelectPartPractice={onSelectPartPractice} />}
        </div>
      </div>
    </div>
  );
};