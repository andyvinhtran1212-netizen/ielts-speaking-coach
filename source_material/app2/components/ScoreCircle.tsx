
import React from 'react';

interface ScoreCircleProps {
    score: number;
}

const ScoreCircle: React.FC<ScoreCircleProps> = ({ score }) => {
    const getScoreColor = () => {
        if (score > 80) return 'text-emerald-500';
        if (score > 60) return 'text-primary-500';
        return 'text-rose-500';
    };

    const center = 21;
    const radius = 18;
    const circlePath = `M${center} ${center - radius} a ${radius} ${radius} 0 0 1 0 ${2 * radius} a ${radius} ${radius} 0 0 1 0 -${2 * radius}`;

    const getBandScore = (s: number) => {
        if (s >= 95) return '9.0';
        if (s >= 90) return '8.5';
        if (s >= 85) return '8.0';
        if (s >= 80) return '7.5';
        if (s >= 75) return '7.0';
        if (s >= 70) return '6.5';
        if (s >= 65) return '6.0';
        if (s >= 60) return '5.5';
        if (s >= 55) return '5.0';
        if (s >= 50) return '4.5';
        if (s >= 45) return '4.0';
        return '3.5';
    };

    return (
        <div className="relative w-44 h-44 mx-auto group">
            <svg className="w-full h-full transform transition-transform group-hover:scale-105" viewBox="0 0 42 42">
                <path
                    className="text-slate-100"
                    d={circlePath}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                />
                <path
                    className={getScoreColor() + " transition-all duration-1000 ease-out"}
                    d={circlePath}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeDasharray={`${score}, 100`}
                    strokeLinecap="round"
                    transform="rotate(-90 21 21)"
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-5xl font-black ${getScoreColor()}`}>{score}</span>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">Score</span>
                <span className={`text-sm font-bold mt-1 px-2 py-0.5 rounded-full bg-slate-100 ${getScoreColor()}`}>Band {getBandScore(score)}</span>
            </div>
        </div>
    );
};

export default ScoreCircle;
