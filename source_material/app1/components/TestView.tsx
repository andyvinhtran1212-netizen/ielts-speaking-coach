import React, { useState, useEffect, useReducer, useCallback, useMemo, useRef } from 'react';
import type { TestState, RecordedAnswer, TestPlan } from '../types';
import { TestPart } from '../types';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { ProgressStepper } from './ProgressStepper';
import { WaveformVisualizer } from './WaveformVisualizer';
import { CueCardDisplay } from './CueCardDisplay';
import { unlockAudioContext } from '../utils/audioContext';
import { P2_PREP_INSTRUCTION, P2_SPEAKING_INSTRUCTION } from '../constants';


interface TestViewProps {
  testPlan: TestPlan;
  onTestComplete: (recordedAnswers: RecordedAnswer[], durationInSeconds: number) => void;
}

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
};

const testReducer = (state: TestState, action: { type: string; payload?: any }): TestState => {
  switch (action.type) {
    case 'NEXT_PART1_QUESTION': {
      const { testPlan, part1CurrentTopicIndex, part1CurrentQuestionIndex } = state;
      const currentTopic = testPlan.part1[part1CurrentTopicIndex];
      // More questions in the current topic
      if (part1CurrentQuestionIndex < currentTopic.questions.length - 1) {
        return { ...state, part1CurrentQuestionIndex: state.part1CurrentQuestionIndex + 1 };
      }
      // More topics in Part 1
      if (part1CurrentTopicIndex < testPlan.part1.length - 1) {
        return { ...state, part: TestPart.Part1TopicTransition, part1CurrentTopicIndex: state.part1CurrentTopicIndex + 1, part1CurrentQuestionIndex: 0 };
      }
      // End of Part 1
      return { ...state, part: TestPart.Part2Intro };
    }
    case 'START_PART2_SPEAKING':
      return { ...state, part: TestPart.Part2Speaking };
    case 'FINISH_PART2':
      return { ...state, part: TestPart.Part3Intro };
    case 'NEXT_PART3_QUESTION': {
      const { testPlan, part3CurrentTopicIndex, part3CurrentQuestionIndex } = state;
      const currentTopic = testPlan.part3[part3CurrentTopicIndex];
      // More questions in the current topic
      if (part3CurrentQuestionIndex < currentTopic.questions.length - 1) {
        return { ...state, part3CurrentQuestionIndex: state.part3CurrentQuestionIndex + 1 };
      }
      // More topics in Part 3
      if (part3CurrentTopicIndex < testPlan.part3.length - 1) {
        return { ...state, part: TestPart.Part3TopicTransition, part3CurrentTopicIndex: state.part3CurrentTopicIndex + 1, part3CurrentQuestionIndex: 0 };
      }
      // End of Part 3
      return { ...state, part: TestPart.Analyzing };
    }
    case 'SET_PART':
      return { ...state, part: action.payload };
    case 'UPDATE_TEST_PLAN':
      return { ...state, testPlan: action.payload };
    default:
      return state;
  }
};

const getDisplayText = (part: TestPart, testState: TestState): string => {
    const { testPlan, part1CurrentTopicIndex, part1CurrentQuestionIndex, part3CurrentTopicIndex, part3CurrentQuestionIndex } = testState;

    switch (part) {
        case TestPart.Part1:
            return testPlan.part1[part1CurrentTopicIndex]?.questions[part1CurrentQuestionIndex]?.text ?? '';
        case TestPart.Part3:
            return testPlan.part3[part3CurrentTopicIndex]?.questions[part3CurrentQuestionIndex]?.text ?? '';
        default:
            return '';
    }
};


export const TestView: React.FC<TestViewProps> = ({ testPlan: initialTextPlan, onTestComplete }) => {
  const [testState, dispatch] = useReducer(testReducer, {
    part: TestPart.Intro,
    testPlan: initialTextPlan,
    part1CurrentTopicIndex: 0,
    part1CurrentQuestionIndex: 0,
    part3CurrentTopicIndex: 0,
    part3CurrentQuestionIndex: 0,
  });

  useEffect(() => {
      dispatch({ type: 'UPDATE_TEST_PLAN', payload: initialTextPlan });
  }, [initialTextPlan]);

  const { startRecording, stopRecording, mediaStream } = useAudioRecorder();
  const [timer, setTimer] = useState(0);
  const [recordedAnswers, setRecordedAnswers] = useState<RecordedAnswer[]>([]);
  const [isProcessingNext, setIsProcessingNext] = useState(false);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const timerEndTimeRef = useRef<number | null>(null);

  const handleNext = useCallback(async () => {
    if (isProcessingNext) return;
    setIsProcessingNext(true);
    
    if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
    }

    const { part, testPlan, part1CurrentTopicIndex, part1CurrentQuestionIndex, part3CurrentTopicIndex, part3CurrentQuestionIndex } = testState;
    let currentPart = '';
    let currentTopic = '';
    let currentQuestionText = '';

    switch (part) {
        case TestPart.Part1:
            currentPart = 'Part 1';
            currentTopic = testPlan.part1[part1CurrentTopicIndex].topic;
            currentQuestionText = testPlan.part1[part1CurrentTopicIndex].questions[part1CurrentQuestionIndex].text;
            break;
        case TestPart.Part2Speaking:
            currentPart = 'Part 2';
            currentTopic = testPlan.part2.topic;
            currentQuestionText = `${testPlan.part2.instruction}\nYou should say:\n${testPlan.part2.points.map(p => `\t•\t${p}`).join('\n')}`;
            break;
        case TestPart.Part3:
            currentPart = 'Part 3';
            currentTopic = testPlan.part3[part3CurrentTopicIndex].topic;
            currentQuestionText = testPlan.part3[part3CurrentTopicIndex].questions[part3CurrentQuestionIndex].text;
            break;
    }
    
    try {
        if (currentQuestionText) {
            const audioBlob = await stopRecording();
            setRecordedAnswers(prev => [...prev, { part: currentPart, topic: currentTopic, question: currentQuestionText, audioBlob, transcript: "" }]);
        }

        switch (part) {
            case TestPart.Part1: dispatch({ type: 'NEXT_PART1_QUESTION' }); break;
            case TestPart.Part3: dispatch({ type: 'NEXT_PART3_QUESTION' }); break;
            case TestPart.Part2Speaking: dispatch({type: 'FINISH_PART2'}); break;
        }
    } catch (error) {
        console.error("Error in handleNext, forcing progression to unfreeze UI:", error);
        switch (part) {
            case TestPart.Part1: dispatch({ type: 'NEXT_PART1_QUESTION' }); break;
            case TestPart.Part3: dispatch({ type: 'NEXT_PART3_QUESTION' }); break;
            case TestPart.Part2Speaking: dispatch({type: 'FINISH_PART2'}); break;
            default: console.warn('Could not determine next step after error.'); break;
        }
    } finally {
        setIsProcessingNext(false);
    }
  }, [testState, stopRecording, isProcessingNext]);

  const testStepKey = useMemo(() => {
    const { part, part1CurrentTopicIndex, part1CurrentQuestionIndex, part3CurrentTopicIndex, part3CurrentQuestionIndex } = testState;
    return `${part}-${part1CurrentTopicIndex}-${part1CurrentQuestionIndex}-${part3CurrentTopicIndex}-${part3CurrentQuestionIndex}`;
  }, [testState]);
  
  const setupTimer = useCallback((duration: number, onEnd: () => void) => {
    const endTime = Date.now() + duration * 1000;
    timerEndTimeRef.current = endTime;

    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    setTimer(duration);

    timerIntervalRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));
        setTimer(remaining);
        if (remaining === 0) {
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
            onEnd();
        }
    }, 250);
  }, []);
  
  const [isReading, setIsReading] = useState(false);
  const [part2Notes, setPart2Notes] = useState('');

  // Main effect to drive the test logic for a single step.
  // This effect runs ONCE per test step (question) and orchestrates the async flow.
  useEffect(() => {
      let isCancelled = false;
      
      const runCurrentTestStep = async () => {
          try {
              if (
                  testState.part === TestPart.Intro || 
                  testState.part === TestPart.Analyzing
              ) {
                  return;
              }
              
              if (isCancelled) return;

              // RECORDING: start the mic and the timer.
              switch (testState.part) {
                  case TestPart.Part1Intro:
                      await new Promise(resolve => setTimeout(resolve, 5000));
                      if (isCancelled) return;
                      dispatch({type: 'SET_PART', payload: TestPart.Part1});
                      break;
                  case TestPart.Part2Intro:
                      await new Promise(resolve => setTimeout(resolve, 5000));
                      if (isCancelled) return;
                      dispatch({type: 'SET_PART', payload: TestPart.Part2Prep});
                      break;
                  case TestPart.Part3Intro:
                      await new Promise(resolve => setTimeout(resolve, 5000));
                      if (isCancelled) return;
                      dispatch({type: 'SET_PART', payload: TestPart.Part3});
                      break;
                  case TestPart.Part1TopicTransition:
                      await new Promise(resolve => setTimeout(resolve, 3000));
                      if (isCancelled) return;
                      dispatch({type: 'SET_PART', payload: TestPart.Part1});
                      break;
                  case TestPart.Part3TopicTransition:
                      await new Promise(resolve => setTimeout(resolve, 3000));
                      if (isCancelled) return;
                      dispatch({type: 'SET_PART', payload: TestPart.Part3});
                      break;
                  case TestPart.Part1:
                      setIsReading(true);
                      await new Promise(resolve => setTimeout(resolve, 2000));
                      if (isCancelled) return;
                      setIsReading(false);

                      await startRecording();
                      if (isCancelled) return;
                      setupTimer(40, handleNext);
                      break;
                  case TestPart.Part2Prep:
                      setupTimer(60, () => dispatch({ type: 'START_PART2_SPEAKING' }));
                      break;
                  case TestPart.Part2Speaking:
                      await startRecording();
                      if (isCancelled) return;
                      setupTimer(120, handleNext);
                      break;
                  case TestPart.Part3:
                      setIsReading(true);
                      await new Promise(resolve => setTimeout(resolve, 2000));
                      if (isCancelled) return;
                      setIsReading(false);

                      await startRecording();
                      if (isCancelled) return;
                      setupTimer(90, handleNext);
                      break;
              }
          } catch (error) {
              console.error("Failed to execute test step:", error);
              if (!isCancelled) {
                  alert("There was an error starting the question. We'll skip to the next one to keep the test moving.");
                  handleNext();
              }
          }
      };

      const startTimer = setTimeout(() => {
          if (!isCancelled) {
              runCurrentTestStep();
          }
      }, 100);

      return () => {
          isCancelled = true;
          clearTimeout(startTimer);
          if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
          }
      };
  // This effect should only re-run when the logical test step changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testStepKey]);


  useEffect(() => {
    if (testState.part === TestPart.Analyzing) {
      const endTime = Date.now();
      const durationInSeconds = startTimeRef.current ? Math.round((endTime - startTimeRef.current) / 1000) : 0;
      onTestComplete(recordedAnswers, durationInSeconds);
    }
  }, [testState.part, recordedAnswers, onTestComplete]);

  const renderContent = () => {
    const { testPlan, part1CurrentTopicIndex, part3CurrentTopicIndex } = testState;

    switch (testState.part) {
      case TestPart.Intro:
        return (
          <div className="text-center space-y-8">
            <div className="w-20 h-20 bg-brand-light rounded-2xl flex items-center justify-center mx-auto shadow-sm border border-neutral-100">
              <svg className="w-10 h-10 text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-4xl sm:text-5xl font-display font-extrabold text-brand-dark tracking-tight">IELTS Speaking Test</h2>
              <p className="mt-4 text-neutral-500 text-lg max-w-xl mx-auto leading-relaxed">This is a full simulation of the test, lasting 11-14 minutes. Please ensure you're in a quiet place and your microphone is ready.</p>
            </div>
            <button 
              onClick={() => {
                unlockAudioContext();
                startTimeRef.current = Date.now();
                dispatch({type: 'SET_PART', payload: TestPart.Part1Intro})
              }} 
              className="px-10 py-4 text-lg font-semibold text-white bg-brand-primary rounded-xl hover:bg-brand-secondary transition-all shadow-md hover:shadow-lg disabled:bg-neutral-300 disabled:shadow-none disabled:cursor-not-allowed">
                Start Test
            </button>
          </div>
        );
      
      case TestPart.Part1Intro:
        return (
          <div className="text-center space-y-6 animate-fade-in">
            <div className="inline-block bg-brand-light text-brand-primary font-bold px-4 py-1.5 rounded-full text-sm tracking-wide uppercase mb-2">Part 1</div>
            <h2 className="text-4xl sm:text-5xl font-display font-extrabold text-brand-dark">Introduction & Interview</h2>
            <p className="text-neutral-500 text-lg max-w-xl mx-auto leading-relaxed">In this part, the examiner will ask you general questions about yourself and a range of familiar topics, such as home, family, work, studies and interests.</p>
          </div>
        );

      case TestPart.Part1TopicTransition:
        return (
          <div className="text-center space-y-6 animate-fade-in">
            <div className="inline-block bg-brand-light text-brand-primary font-bold px-4 py-1.5 rounded-full text-sm tracking-wide uppercase mb-2">New Topic</div>
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-brand-dark">Let's move on to talk about</h2>
            <p className="text-4xl font-display font-extrabold text-brand-secondary mt-2">{testPlan.part1[part1CurrentTopicIndex]?.topic}</p>
          </div>
        );

      case TestPart.Part2Intro:
        return (
          <div className="text-center space-y-6 animate-fade-in">
             <div className="inline-block bg-brand-light text-brand-primary font-bold px-4 py-1.5 rounded-full text-sm tracking-wide uppercase mb-2">Part 2</div>
            <h2 className="text-4xl sm:text-5xl font-display font-extrabold text-brand-dark">Long Turn</h2>
            <p className="text-neutral-500 text-lg max-w-xl mx-auto leading-relaxed">You will be given a cue card asking you to talk about a particular topic. You will have 1 minute to prepare and make notes, and then you will speak for 1-2 minutes.</p>
          </div>
        );

      case TestPart.Part3Intro:
        return (
          <div className="text-center space-y-6 animate-fade-in">
             <div className="inline-block bg-brand-light text-brand-primary font-bold px-4 py-1.5 rounded-full text-sm tracking-wide uppercase mb-2">Part 3</div>
            <h2 className="text-4xl sm:text-5xl font-display font-extrabold text-brand-dark">Two-Way Discussion</h2>
            <p className="text-neutral-500 text-lg max-w-xl mx-auto leading-relaxed">In this part, you will be asked further questions connected to the topic in Part 2. These questions will give you the opportunity to discuss more abstract issues and ideas.</p>
          </div>
        );

      case TestPart.Part3TopicTransition:
        return (
          <div className="text-center space-y-6 animate-fade-in">
            <div className="inline-block bg-brand-light text-brand-primary font-bold px-4 py-1.5 rounded-full text-sm tracking-wide uppercase mb-2">New Topic</div>
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-brand-dark">Let's move on to talk about</h2>
            <p className="text-4xl font-display font-extrabold text-brand-secondary mt-2">{testPlan.part3[part3CurrentTopicIndex]?.topic}</p>
          </div>
        );

      case TestPart.Part1:
      case TestPart.Part3: {
        const isPart1 = testState.part === TestPart.Part1;
        const topicSet = isPart1 ? testPlan.part1[part1CurrentTopicIndex] : testPlan.part3[part3CurrentTopicIndex];
        return (
          <div className="text-center flex flex-col items-center w-full max-w-3xl mx-auto">
            <div className="inline-block bg-brand-light text-brand-primary font-bold px-4 py-1.5 rounded-full text-sm tracking-wide uppercase mb-6 shadow-sm border border-brand-primary/10">
              {isPart1 ? 'Part 1' : 'Part 3'} <span className="text-brand-secondary mx-2">•</span> {topicSet?.topic ?? 'Loading Topic...'}
            </div>
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-brand-dark mb-10 min-h-[8rem] flex items-center justify-center leading-tight">{getDisplayText(testState.part, testState)}</h2>
            
            {!isReading && (
                <div className="w-full bg-neutral-50 rounded-3xl p-8 border border-neutral-100 shadow-inner">
                    <div className="text-center mb-6">
                        <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Time Remaining</p>
                        <p className="text-6xl sm:text-7xl font-display font-extrabold text-brand-primary tabular-nums tracking-tight">{formatTime(timer)}</p>
                    </div>
                    {mediaStream && <div className="h-16 mb-6"><WaveformVisualizer mediaStream={mediaStream} /></div>}
                    <button onClick={handleNext} disabled={isProcessingNext || isReading} className="px-8 py-3.5 text-base font-semibold text-white bg-brand-dark rounded-xl hover:bg-neutral-800 transition-all shadow-md hover:shadow-lg disabled:bg-neutral-300 disabled:shadow-none disabled:cursor-not-allowed">Next Question</button>
                </div>
            )}
          </div>
        );
      }
        
      case TestPart.Part2Prep:
        return (
          <div className="flex flex-col items-center w-full max-w-4xl mx-auto">
             <div className="inline-block bg-brand-light text-brand-primary font-bold px-4 py-1.5 rounded-full text-sm tracking-wide uppercase mb-4 shadow-sm border border-brand-primary/10">
              Part 2 <span className="text-brand-secondary mx-2">•</span> Preparation
            </div>
            <p className="text-center text-neutral-500 mb-8 max-w-2xl text-lg">{P2_PREP_INSTRUCTION}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
                <div className="h-full">
                    <CueCardDisplay topic={testPlan.part2.topic} instruction={testPlan.part2.instruction} points={testPlan.part2.points} />
                </div>
                <div className="flex flex-col h-full bg-neutral-50 rounded-3xl p-6 sm:p-8 border border-neutral-100 shadow-inner">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm font-bold text-neutral-500 uppercase tracking-wider flex items-center">
                            <svg className="w-4 h-4 mr-2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            Your Notes
                        </p>
                    </div>
                    <textarea 
                        className="w-full flex-grow p-5 border border-neutral-200 rounded-2xl focus:ring-4 focus:ring-brand-primary/10 focus:border-brand-primary resize-none bg-white text-neutral-700 transition-all custom-scrollbar text-base leading-relaxed shadow-sm" 
                        placeholder="Type your notes here... They will remain visible while you speak."
                        value={part2Notes}
                        onChange={(e) => setPart2Notes(e.target.value)}
                    ></textarea>
                </div>
            </div>
            <div className="text-center mt-10 bg-white px-10 py-6 rounded-3xl shadow-lg border border-neutral-100 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-brand-secondary"></div>
                <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Preparation Time</p>
                <p className="text-6xl font-display font-extrabold text-brand-dark tabular-nums tracking-tight">{formatTime(timer)}</p>
            </div>
          </div>
        );

      case TestPart.Part2Speaking:
        return (
          <div className="flex flex-col items-center w-full max-w-4xl mx-auto">
             <div className="inline-block bg-red-50 text-red-600 font-bold px-4 py-1.5 rounded-full text-sm tracking-wide uppercase mb-4 shadow-sm border border-red-100 animate-pulse">
              Part 2 <span className="text-red-400 mx-2">•</span> Speaking
            </div>
            <p className="text-center text-neutral-500 mb-8 max-w-2xl text-lg">{P2_SPEAKING_INSTRUCTION}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full mb-10">
                <div className="h-full">
                    <CueCardDisplay topic={testPlan.part2.topic} instruction={testPlan.part2.instruction} points={testPlan.part2.points} />
                </div>
                <div className="flex flex-col h-full bg-neutral-50 rounded-3xl p-6 sm:p-8 border border-neutral-100 shadow-inner">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm font-bold text-neutral-500 uppercase tracking-wider flex items-center">
                            <svg className="w-4 h-4 mr-2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            Your Notes
                        </p>
                    </div>
                    <textarea 
                        className="w-full flex-grow p-5 border border-neutral-200 rounded-2xl focus:ring-4 focus:ring-brand-primary/10 focus:border-brand-primary resize-none bg-white text-neutral-700 transition-all custom-scrollbar text-base leading-relaxed shadow-sm" 
                        placeholder="Type your notes here..."
                        value={part2Notes}
                        onChange={(e) => setPart2Notes(e.target.value)}
                    ></textarea>
                </div>
            </div>
            <div className="text-center bg-white px-10 py-8 rounded-3xl shadow-lg border border-neutral-100 w-full max-w-md relative overflow-hidden">
                 <div className="absolute top-0 left-0 w-full h-1 bg-red-500"></div>
                 <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">Time Remaining</p>
                <p className="text-6xl font-display font-extrabold text-brand-dark tabular-nums tracking-tight mb-6">{formatTime(timer)}</p>
                 {mediaStream && <div className="h-12 mb-6"><WaveformVisualizer mediaStream={mediaStream} /></div>}
                 <button onClick={handleNext} disabled={isProcessingNext} className="w-full px-6 py-3.5 text-base font-bold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-all shadow-md hover:shadow-lg disabled:bg-neutral-300 disabled:shadow-none">Finish Speaking</button>
            </div>
          </div>
        );

       case TestPart.Analyzing:
        return (
            <div className="text-center space-y-8">
                <div className="w-20 h-20 bg-brand-light rounded-2xl flex items-center justify-center mx-auto shadow-sm border border-neutral-100">
                    <svg className="animate-spin h-10 w-10 text-brand-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
                <div>
                    <h2 className="text-3xl sm:text-4xl font-display font-bold text-brand-dark tracking-tight">Test Complete!</h2>
                    <p className="mt-3 text-neutral-500 text-lg">Finalizing your recordings and generating your personalized feedback report...</p>
                </div>
            </div>
        )
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-brand-light p-4 font-sans">
      <div className="w-full max-w-4xl bg-white p-8 sm:p-12 rounded-3xl shadow-xl border border-neutral-100 transition-all duration-500 min-h-[40rem] flex flex-col justify-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-secondary to-brand-primary"></div>
        {testState.part !== TestPart.Intro && <div className="mb-10"><ProgressStepper currentPart={testState.part} /></div>}
        <div className="flex-grow flex flex-col justify-center">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};
