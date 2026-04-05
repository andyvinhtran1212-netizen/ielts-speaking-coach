import type { AnalysisResult, TrackedActivity } from '../types';

const STORAGE_KEY = 'speakwise_student_data';

/**
 * Retrieves all tracked student activity from localStorage.
 * @returns {TrackedActivity[]} An array of tracked activities.
 */
export const getTrackedData = (): TrackedActivity[] => {
  try {
    const rawData = localStorage.getItem(STORAGE_KEY);
    if (rawData) {
      const data = JSON.parse(rawData);
      // Basic validation to ensure it's an array
      return Array.isArray(data) ? data : [];
    }
  } catch (error) {
    console.error("Failed to retrieve or parse tracked data:", error);
  }
  return [];
};

/**
 * Saves a new activity to localStorage.
 * @param activity - The activity data to save.
 */
const saveActivity = (activity: Omit<TrackedActivity, 'id' | 'timestamp'>) => {
  try {
    const existingData = getTrackedData();
    const newActivity: TrackedActivity = {
      ...activity,
      id: `${new Date().getTime()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
    const updatedData = [newActivity, ...existingData]; // Prepend new activity
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedData));
    console.log('[PRACTICE TRACKING] Student activity logged:', JSON.stringify(newActivity, null, 2));
  } catch (error) {
    console.error("Failed to save activity:", error);
  }
};


/**
 * Simulates sending script analysis data to a backend for teacher review.
 * For this version, it logs the data and saves it to localStorage.
 */
export const trackScriptAnalysis = (
  studentCode: string,
  originalScript: string,
  analysisResult: AnalysisResult
): void => {
  saveActivity({
    studentCode,
    activityType: 'Script Analysis',
    originalScript,
    analysisResult,
  });
};
