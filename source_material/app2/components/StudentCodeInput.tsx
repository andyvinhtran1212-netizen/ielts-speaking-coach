
import React, { useState } from 'react';
import { isStudentValid } from '../services/studentService';

interface StudentCodeInputProps {
  onLoginSuccess: (code: string) => void;
}

const StudentCodeInput: React.FC<StudentCodeInputProps> = ({ onLoginSuccess }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim();

    if (!trimmedCode) {
      setError('Please enter your access code.');
      return;
    }
    
    if (isStudentValid(trimmedCode)) {
      onLoginSuccess(trimmedCode);
    } else {
      setError('Invalid access code. Please check your code and try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto bg-white p-8 rounded-xl shadow-lg text-center">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-primary">SpeakWise AI</h1>
          <p className="text-secondary mt-1">Your Personal English Speaking Coach</p>
        </header>
        <form onSubmit={handleSubmit}>
          <h2 className="text-xl font-semibold text-dark mb-4">Enter Your Access Code</h2>
          <p className="text-secondary mb-4 text-sm">You need a valid access code to use the platform.</p>
          <input
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError('');
            }}
            placeholder="Your access code..."
            className={`w-full text-center p-3 border rounded-lg focus:ring-2 focus:border-transparent transition duration-200 ${error ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-primary'}`}
            aria-label="Access Code"
            aria-invalid={!!error}
            aria-describedby="code-error"
          />
          {error && <p id="code-error" className="text-red-500 text-sm mt-2">{error}</p>}
          <button
            type="submit"
            className="mt-6 w-full bg-primary text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:bg-gray-400"
            disabled={!code.trim()}
          >
            Start Session
          </button>
        </form>
      </div>
       <footer className="text-center py-6 text-gray-500 text-sm absolute bottom-0">
        <p>Powered by Gemini API</p>
      </footer>
    </div>
  );
};

export default StudentCodeInput;
