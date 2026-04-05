
import React, { RefObject, useState, useEffect, useCallback, useRef } from 'react';
import Loader from './Loader';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { MicIcon } from './icons/MicIcon';
import { StopIcon } from './icons/StopIcon';
import SoundWave from './SoundWave';
import { transcribeAudio } from '../services/geminiService';
import { blobToBase64, getFriendlyErrorMessage } from '../App';

interface ScriptInputProps {
  question: string;
  onQuestionChange: (value: string) => void;
  script: string;
  onScriptChange: (value: string) => void;
  onAnalyze: (analysisType: 'standard' | 'advanced') => void;
  isLoading: boolean;
  questionRef: RefObject<HTMLTextAreaElement>;
}

const ScriptInput: React.FC<ScriptInputProps> = ({ 
  question, onQuestionChange, 
  script, onScriptChange, 
  onAnalyze,
  isLoading, 
  questionRef
}) => {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    recorderState,
    audioBlob,
    audioURL,
    recordingTime,
    mediaStream,
    startRecording,
    stopRecording,
    error: recorderError
  } = useAudioRecorder({ maxRecordingSeconds: 120 });
  
  const transcribeRecording = useCallback(async (blob: Blob) => {
      setIsTranscribing(true);
      setTranscriptionError(null);
      try {
          const base64 = await blobToBase64(blob);
          const transcript = await transcribeAudio(base64, blob.type);
          if (transcript === "[No speech detected]") {
              setTranscriptionError("We couldn't catch that. Please speak clearly into the microphone.");
          } else {
              onScriptChange(transcript);
          }
      } catch (err) {
          setTranscriptionError(getFriendlyErrorMessage(err));
      } finally {
          setIsTranscribing(false);
      }
  }, [onScriptChange]);

  useEffect(() => {
    if (recorderState === 'finished' && audioBlob) {
        transcribeRecording(audioBlob);
    }
  }, [recorderState, audioBlob, transcribeRecording]);

  const handleStartRecording = () => {
    onScriptChange('');
    setTranscriptionError(null);
    startRecording();
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const isSubmitDisabled = isLoading || !script.trim() || !question.trim() || isTranscribing || recorderState === 'recording';

  return (
    <div className="bg-white rounded-3xl shadow-soft border border-slate-100 overflow-hidden">
      <div className="p-8 space-y-8">
        <div>
          <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
            <span className="w-6 h-6 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-xs">1</span>
            Topic & Input
          </h2>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="question-input" className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Practice Question</label>
              <textarea
                ref={questionRef}
                id="question-input"
                value={question}
                onChange={(e) => onQuestionChange(e.target.value)}
                placeholder="E.g., What are the benefits of learning a new language?"
                className="w-full h-28 p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-primary-500 transition-all resize-none text-slate-700 font-medium placeholder:text-slate-300"
                disabled={isLoading || recorderState === 'recording' || isTranscribing}
              />
            </div>

            <div className="pt-4 border-t border-slate-50">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 ml-1">Your Spoken Response</label>
              
              <div className="flex flex-col md:flex-row items-center gap-6">
                {recorderState === 'recording' ? (
                  <div className="w-full bg-rose-50 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-6 border border-rose-100">
                    <button onClick={stopRecording} className="flex items-center gap-2 px-6 py-3 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-600 transition shadow-lg shadow-rose-200">
                      <StopIcon />
                      <span>Stop</span>
                      <span className="ml-2 font-mono bg-white/20 px-2 py-0.5 rounded text-sm">{formatTime(recordingTime)}</span>
                    </button>
                    {mediaStream && <SoundWave mediaStream={mediaStream} width={250} height={40} baseColor="#fecaca" activeColor="#f43f5e" />}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-4 w-full">
                    <button 
                      onClick={handleStartRecording} 
                      disabled={isLoading || isTranscribing} 
                      className="flex-1 flex items-center justify-center gap-3 px-8 py-4 bg-primary-600 text-white font-bold rounded-2xl hover:bg-primary-700 transition shadow-lg shadow-primary-500/20 disabled:opacity-50 disabled:shadow-none"
                    >
                      <MicIcon />
                      {isTranscribing ? 'Processing...' : 'Record Answer'}
                    </button>
                    <button 
                      onClick={() => fileInputRef.current?.click()} 
                      disabled={isLoading || isTranscribing}
                      className="flex items-center justify-center gap-3 px-8 py-4 bg-white border-2 border-slate-200 text-slate-600 font-bold rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition"
                    >
                      <span>Upload Audio</span>
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" accept="audio/*" onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) transcribeRecording(file);
                    }} />
                  </div>
                )}
              </div>

              {script && !isTranscribing && (
                <div className="mt-6 bg-slate-50 p-6 rounded-2xl border border-slate-100 animate-fade-in-up">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-[10px] font-bold text-primary-500 uppercase tracking-[0.2em]">Voice Transcript</span>
                        {audioURL && (
                          <a href={audioURL} download="my-response.webm" className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-primary-600 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Download
                          </a>
                        )}
                    </div>
                    <p className="text-slate-700 leading-relaxed font-medium italic">"{script}"</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-100">
          <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
            <span className="w-6 h-6 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-xs">2</span>
            Evaluation Level
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => onAnalyze('standard')}
              disabled={isSubmitDisabled}
              className="p-6 text-left bg-slate-50 rounded-2xl border-2 border-transparent hover:border-primary-200 hover:bg-primary-50/30 transition group disabled:opacity-40"
            >
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-bold text-slate-800 group-hover:text-primary-600 transition">Standard Analysis</h4>
                <div className="text-[10px] font-bold px-2 py-1 bg-white text-slate-400 rounded-full">INTERMEDIATE</div>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">Focuses on natural phrasing and basic grammar accuracy. Best for daily English.</p>
            </button>
            <button
              onClick={() => onAnalyze('advanced')}
              disabled={isSubmitDisabled}
              className="p-6 text-left bg-slate-50 rounded-2xl border-2 border-transparent hover:border-primary-200 hover:bg-primary-50/30 transition group disabled:opacity-40"
            >
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-bold text-slate-800 group-hover:text-primary-600 transition">IELTS Advanced</h4>
                <div className="text-[10px] font-bold px-2 py-1 bg-primary-600 text-white rounded-full">BAND 7.0+</div>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">Upgrades vocabulary and sentence complexity. Best for exam preparation.</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScriptInput;
