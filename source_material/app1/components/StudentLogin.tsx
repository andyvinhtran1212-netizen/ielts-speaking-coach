import React, { useState } from 'react';
import { STUDENT_CODES } from '../constants';

interface StudentLoginProps {
  onLogin: () => void;
  onModeratorLogin: () => void;
}

export const StudentLogin: React.FC<StudentLoginProps> = ({ onLogin, onModeratorLogin }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleLogin = () => {
    const trimmedCode = code.trim();
    if (trimmedCode === 'moderator01') {
      localStorage.setItem('user_role', 'moderator');
      onModeratorLogin();
    } else if (STUDENT_CODES.includes(trimmedCode)) {
      localStorage.setItem('user_role', 'student');
      setError('');
      onLogin();
    } else {
      setError('Invalid access code. Please try again.');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-brand-light font-sans p-4">
      <div className="w-full max-w-md p-8 sm:p-10 space-y-8 bg-white rounded-3xl shadow-xl border border-neutral-100">
        <div className="text-center">
          <div className="w-16 h-16 bg-brand-light rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-neutral-100">
            <svg className="w-8 h-8 text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-display font-bold text-brand-dark tracking-tight">IELTS Speaking</h1>
          <p className="mt-3 text-neutral-500 text-sm">Enter your access code to begin your practice session.</p>
        </div>
        <div className="space-y-6">
          <div>
            <label htmlFor="code" className="sr-only">Access Code</label>
            <input
              id="code"
              name="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              className="appearance-none rounded-xl relative block w-full px-4 py-3.5 border border-neutral-200 placeholder-neutral-400 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary sm:text-base transition-all bg-neutral-50 focus:bg-white"
              placeholder="Enter Your Access Code"
            />
          </div>
          {error && <p className="text-sm text-center text-red-500 font-medium">{error}</p>}
          <div>
            <button
              onClick={handleLogin}
              className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent text-base font-semibold rounded-xl text-white bg-brand-primary hover:bg-brand-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary transition-all duration-200 shadow-md hover:shadow-lg"
            >
              Start Practice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
