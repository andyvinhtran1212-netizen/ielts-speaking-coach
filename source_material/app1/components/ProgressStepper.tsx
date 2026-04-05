
import React from 'react';
import { TestPart } from '../types';
import { CheckIcon } from './Icons';

const steps = ['Part 1', 'Part 2', 'Part 3', 'Finish'];

const getStepIndex = (part: TestPart): number => {
    switch (part) {
        case TestPart.Intro:
        case TestPart.Part1Intro:
        case TestPart.Part1:
        case TestPart.Part1TopicTransition:
            return 0;
        case TestPart.Part2Intro:
        case TestPart.Part2Prep:
        case TestPart.Part2Speaking:
            return 1;
        case TestPart.Part3Intro:
        case TestPart.Part3:
        case TestPart.Part3TopicTransition:
            return 2;
        case TestPart.Analyzing:
        case TestPart.Results:
            return 3;
        default:
            return 0;
    }
};

export const ProgressStepper: React.FC<{ currentPart: TestPart }> = ({ currentPart }) => {
    const activeIndex = getStepIndex(currentPart);

    return (
        <div className="w-full px-4 sm:px-8 max-w-3xl mx-auto">
            <div className="relative flex items-center justify-between">
                <div className="absolute left-0 top-1/2 h-1.5 w-full -translate-y-1/2 bg-neutral-100 rounded-full overflow-hidden">
                    <div
                        className="absolute h-full bg-brand-primary transition-all duration-700 ease-in-out rounded-full"
                        style={{ width: `${(activeIndex / (steps.length - 1)) * 100}%` }}
                    />
                </div>
                {steps.map((step, index) => {
                    const isActive = index === activeIndex;
                    const isCompleted = index < activeIndex;

                    return (
                        <div key={step} className="relative flex flex-col items-center text-center group">
                            <div className={`
                                z-10 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full transition-all duration-500 shrink-0 shadow-sm
                                ${isCompleted ? 'bg-brand-primary text-white shadow-brand-primary/30' : ''}
                                ${isActive ? 'bg-white ring-4 ring-brand-primary/20 text-brand-primary border-2 border-brand-primary shadow-lg scale-110' : ''}
                                ${!isCompleted && !isActive ? 'bg-white text-neutral-400 border-2 border-neutral-200' : ''}
                            `}>
                                {isCompleted ? <CheckIcon className="h-5 w-5 sm:h-6 sm:w-6" /> : <span className={`font-bold ${isActive ? 'text-lg' : 'text-base'}`}>{index + 1}</span>}
                            </div>
                            <span className={`
                                mt-3 text-xs sm:text-sm font-bold tracking-wide uppercase transition-colors duration-300
                                ${isActive ? 'text-brand-dark' : 'text-neutral-400'}
                                ${isCompleted ? 'text-brand-primary' : ''}
                            `}>
                                {step}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
