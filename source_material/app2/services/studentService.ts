
import { VALID_STUDENT_CODES } from '../config';
import type { Student } from '../types';

/**
 * Initializes the list of valid student codes.
 * Always relies on the VALID_STUDENT_CODES from config.ts to ensure
 * that any developer-side removals take effect immediately.
 * @returns {Set<string>} A set of uppercased student codes for efficient lookup.
 */
const initializeStudentCodes = (): Set<string> => {
  // We use the config directly as the source of truth for allowed codes.
  return new Set(VALID_STUDENT_CODES.map(code => code.toUpperCase()));
};

const validStudentCodes = initializeStudentCodes();

/**
 * Checks if a given student code is valid by comparing it against the current list.
 * The comparison is case-insensitive.
 * @param {string} code - The student code to validate.
 * @returns {boolean} True if the code is valid, false otherwise.
 */
export const isStudentValid = (code: string): boolean => {
  const upperCaseCode = code.trim().toUpperCase();
  if (!upperCaseCode) return false;
  return validStudentCodes.has(upperCaseCode);
};
