import type { ApiGetJson } from '@/lib/openapi-contract';

export type ListeningOverviewWire = ApiGetJson<'/api/listening/overview'>;
export type ListeningProgrammeLessonsWire =
  ApiGetJson<'/api/listening/programmes/{programme_id}/lessons'>;
export type ListeningLessonDetailWire =
  ApiGetJson<'/api/listening/lessons/{lesson_id}'>;
export type ListeningProgrammePlayerWire =
  ApiGetJson<'/api/listening/tests/{test_id}'>;
export type ListeningProgrammeReviewWire =
  ApiGetJson<'/api/listening/tests/attempts/{attempt_id}/review'>;
export type ListeningGuidedStateWire =
  ApiGetJson<'/api/listening/tests/attempts/{attempt_id}/guided-state'>;
