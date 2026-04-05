
import React, { useState, useEffect } from 'react';

interface TabsProps {
  activeTab: 'practice' | 'test';
  setActiveTab: (tab: 'practice' | 'test') => void;
  isTestUnlocked: boolean;
}

const Tabs: React.FC<TabsProps> = ({ activeTab, setActiveTab, isTestUnlocked }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    if (showTooltip) {
      const timer = setTimeout(() => setShowTooltip(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showTooltip]);

  return (
    <div className="relative w-full max-w-sm flex flex-col items-center">
      <div className="bg-slate-200/50 p-1.5 rounded-2xl flex items-center w-full shadow-inner">
        <button
          onClick={() => setActiveTab('practice')}
          className={`flex-1 py-3 px-6 rounded-xl text-sm font-bold transition-all duration-300 ${
            activeTab === 'practice' 
              ? 'bg-white text-primary-600 shadow-soft' 
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Practice Mode
        </button>
        <div className="flex-1 relative">
          <button
            onClick={() => {
                if (isTestUnlocked) {
                    setActiveTab('test');
                } else {
                    setShowTooltip(true);
                }
            }}
            className={`w-full py-3 px-6 rounded-xl text-sm font-bold transition-all duration-300 ${
              activeTab === 'test' 
                ? 'bg-white text-primary-600 shadow-soft' 
                : isTestUnlocked 
                    ? 'text-slate-500 hover:text-slate-700' 
                    : 'text-slate-400 opacity-50 cursor-not-allowed'
            }`}
          >
            IELTS Test
          </button>
        </div>
      </div>

      {showTooltip && !isTestUnlocked && (
        <div className="absolute -bottom-14 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white text-xs px-4 py-2.5 rounded-lg shadow-lg whitespace-nowrap animate-fade-in-up z-20">
          <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-slate-800 rotate-45"></div>
          Vui lòng đạt điểm Pass ở Practice Mode trước!
        </div>
      )}
    </div>
  );
};

export default Tabs;
