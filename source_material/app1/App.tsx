import React, { useState, useEffect } from 'react';
import { StudentLogin } from './components/StudentLogin';
import { ModeSelection } from './components/ModeSelection';
import { ModeratorView } from './components/ModeratorView';
import { CustomTestSetup } from './components/CustomTestSetup';
import { TestView } from './components/TestView';
import { ResultsView } from './components/ResultsView';
import { PartPracticeSetup } from './components/PartPracticeSetup';
import { PartPracticeView } from './components/PartPracticeView';
import { generatePart3Topics, analyzeSpeakingTest, transcribeAudio, generateQuestionsForPart1Topic, generateCueCardForPart2Topic } from './services/geminiService';
import type { TestPlan, AnalysisResult, RecordedAnswer, PracticePart } from './types';

type View = 'login' | 'mode_selection' | 'moderator_view' | 'custom_test_setup' | 'part_practice_setup' | 'generating_test' | 'student_test' | 'part_practice_session' | 'analyzing' | 'student_results';

const LoadingView: React.FC<{ text: string }> = ({ text }) => (
    <div className="flex flex-col items-center justify-center min-h-screen text-center bg-brand-light p-4">
        <div className="bg-white p-10 sm:p-12 rounded-3xl shadow-2xl border border-neutral-100 max-w-md w-full relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-brand-primary"></div>
            <div className="relative w-24 h-24 mx-auto mb-8">
                <div className="absolute inset-0 border-4 border-brand-light rounded-full"></div>
                <div className="absolute inset-0 border-4 border-brand-primary rounded-full border-t-transparent animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <svg className="w-10 h-10 text-brand-primary animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                </div>
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-brand-dark mb-4 tracking-tight">{text}</h2>
            <p className="text-neutral-500 text-lg leading-relaxed">The AI is preparing your personalized session. This may take a moment.</p>
        </div>
    </div>
);

function App() {
  const [view, setView] = useState<View>('login');
  
  const [testPlan, setTestPlan] = useState<TestPlan | null>(null);
  const [testResult, setTestResult] = useState<AnalysisResult | null>(null);
  const [structuredAnswers, setStructuredAnswers] = useState<RecordedAnswer[] | null>(null);
  const [testDuration, setTestDuration] = useState<number | null>(null);

  const [practicePart, setPracticePart] = useState<PracticePart | null>(null);
  const [practiceTopics, setPracticeTopics] = useState<{part1: string[], part2: string[], part3: string[]} | null>(null);

  const handleLogin = () => {
    setView('mode_selection');
  };

  const handleModeratorLogin = () => {
    setView('moderator_view');
  }

  const handleStartCustomTest = async (part1Topics: string[], part2Topics: string[]) => {
    setView('generating_test');

    try {
        // 1. Randomly select topics
        const shuffledP1 = [...part1Topics].sort(() => 0.5 - Math.random());
        const selectedP1TopicStrings = shuffledP1.slice(0, 3);
        
        const selectedP2TopicString = part2Topics[Math.floor(Math.random() * part2Topics.length)];

        // 2. Generate questions for selected topics in parallel
        const part1Promises = selectedP1TopicStrings.map(topic => 
            generateQuestionsForPart1Topic(topic).then(questions => ({ topic, questions }))
        );
        const part2Promise = generateCueCardForPart2Topic(selectedP2TopicString);

        const [part1, part2] = await Promise.all([
            Promise.all(part1Promises),
            part2Promise
        ]);

        if (!part2) {
            throw new Error("Failed to generate Part 2 cue card.");
        }

        // 3. Generate Part 3 based on Part 2
        const part3 = await generatePart3Topics(part2);

        // Assemble the initial test plan
        const initialTestPlan: TestPlan = { part1, part2, part3 };
        
        setTestPlan(initialTestPlan);
        setView('student_test');

    } catch (error) {
        console.error("Failed to create the final test plan:", error);
        alert("There was an error generating your test from the selected topics. Please try again.");
        setView('custom_test_setup'); // Go back to setup on error
    }
  };
  
  const handleTestComplete = async (recordedAnswers: RecordedAnswer[], durationInSeconds: number) => {
      setView('analyzing');
      setTestDuration(durationInSeconds);

      try {
          // Transcribe all audio blobs in parallel IF they exist. For live test, they will be empty.
          const answersWithTranscripts = await Promise.all(
              recordedAnswers.map(async (answer) => {
                  if (answer.audioBlob && answer.audioBlob.size > 0 && !answer.transcript) {
                      const transcript = await transcribeAudio(answer.audioBlob);
                      return { ...answer, transcript };
                  }
                  return answer; 
              })
          );
          setStructuredAnswers(answersWithTranscripts);
          
          const fullTranscript = answersWithTranscripts
              .map(a => `Examiner: ${a.question}\nStudent: ${a.transcript}`)
              .join('\n\n');
              
          const analysis = await analyzeSpeakingTest(fullTranscript.trim());
          setTestResult(analysis);
          setView('student_results');
      } catch (error) {
          console.error("Error during analysis:", error);
          alert("There was an error analyzing your test. Please try again.");
          setView('mode_selection');
      }
  };

  const handleStartPartPractice = (part: PracticePart, topics: {part1: string[], part2: string[], part3: string[]}) => {
    setPracticePart(part);
    setPracticeTopics(topics);
    setView('part_practice_session');
  };

  const handleRetakeTest = () => {
      setTestResult(null);
      setStructuredAnswers(null);
      setTestPlan(null);
      setTestDuration(null);
      setView('mode_selection');
  }

  const renderView = () => {
    switch (view) {
      case 'login':
        return <StudentLogin onLogin={handleLogin} onModeratorLogin={handleModeratorLogin} />;
      case 'mode_selection':
        return <ModeSelection 
            onSelectCustom={() => setView('custom_test_setup')} 
            onSelectPartPractice={() => setView('part_practice_setup')}
        />;
       case 'moderator_view':
        return <ModeratorView
            onSelectCustom={() => setView('custom_test_setup')}
            onSelectPartPractice={() => setView('part_practice_setup')}
        />;
      case 'custom_test_setup':
        return <CustomTestSetup onStartTest={handleStartCustomTest} onBack={() => setView(localStorage.getItem('user_role') === 'moderator' ? 'moderator_view' : 'mode_selection')} />;
      case 'part_practice_setup':
        return <PartPracticeSetup onStartPractice={handleStartPartPractice} onBack={() => setView(localStorage.getItem('user_role') === 'moderator' ? 'moderator_view' : 'mode_selection')} initialTopics={practiceTopics} />;
      case 'part_practice_session':
        if (practicePart && practiceTopics) {
          let topicsForPart: string[] = [];
          if (practicePart === "PART_1") topicsForPart = practiceTopics.part1;
          else if (practicePart === "PART_2") topicsForPart = practiceTopics.part2;
          else if (practicePart === "PART_3") topicsForPart = practiceTopics.part3;

          return <PartPracticeView 
              part={practicePart} 
              topics={topicsForPart} 
              onEndPractice={() => {
                  setPracticePart(null);
                  setView('part_practice_setup');
              }} 
          />;
        }
        return <ModeSelection 
            onSelectCustom={() => setView('custom_test_setup')} 
            onSelectPartPractice={() => setView('part_practice_setup')}
        />;
      case 'generating_test':
        return <LoadingView text="Assembling Your Test..." />;
      case 'analyzing':
         return <LoadingView text="Analyzing Your Performance..." />;
      case 'student_test':
        if (testPlan) {
            return <TestView testPlan={testPlan} onTestComplete={handleTestComplete} />;
        }
        return <ModeSelection 
            onSelectCustom={() => setView('custom_test_setup')} 
            onSelectPartPractice={() => setView('part_practice_setup')}
        />;
      case 'student_results':
        if (testResult && structuredAnswers && testDuration !== null) {
          return <ResultsView result={testResult} structuredAnswers={structuredAnswers} onRetakeTest={handleRetakeTest} testDuration={testDuration} />;
        }
        return <ModeSelection 
            onSelectCustom={() => setView('custom_test_setup')} 
            onSelectPartPractice={() => setView('part_practice_setup')}
        />;
      default:
        return <StudentLogin onLogin={handleLogin} onModeratorLogin={handleModeratorLogin} />;
    }
  };

  return <div className="App">{renderView()}</div>;
}

export default App;
