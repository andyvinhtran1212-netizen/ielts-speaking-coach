# Tasks

- [ ] T001 Grader service, prompt assets, model config and usage logging. `owns: backend/services/sentence_lab_grader.py, backend/assets/sentence_lab/, backend/config.py, backend/services/ai_usage_logger.py`
- [ ] T002 Submit, state, rewrite route and play-path gating. `depends: T001` `owns: backend/services/quiz_service.py, backend/routers/quiz.py`
- [ ] T003 Importer and calibration scripts. `depends: T001` `owns: backend/scripts/import_sentence_lab_course5.py, backend/scripts/calibrate_sentence_lab.py`
- [ ] T004 Learner UI and API types. `depends: T002` `owns: frontend/public/js/course-writing.js, frontend/app/(authed)/course-exercises/course-behavior.tsx, frontend/public/css/course-exercises.css, frontend/types/api.d.ts`
- [ ] T005 Tests, runbook and staging acceptance. `depends: T002, T003, T004`
