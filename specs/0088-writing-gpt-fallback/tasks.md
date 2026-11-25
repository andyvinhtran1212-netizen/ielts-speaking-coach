# Tasks

- [ ] T001 Setting và nhánh `_try_openai` trong grader. `owns: backend/config.py, backend/services/gemini_writing_grader.py`
- [ ] T002 Ghi usage, cost và sổ lỗi cho lượt OpenAI. **Chặn merge:** xác định ngưỡng long context của gpt-6.1-terra trên trang giá OpenAI và thêm dòng giá long context nếu prompt Writing (~15k token) vượt ngưỡng. `depends: T001` `owns: backend/services/gemini_writing_grader.py, backend/services/ai_router.py`
- [ ] T003 Tests FR-001..FR-007. `depends: T001, T002` `owns: backend/tests/test_writing_openai_fallback.py`
- [ ] T004 Staging: owner đặt env, ép Claude lỗi, kiểm 10 bài (Success criteria), rồi đo lại theo FR-008 với trần lượt gọi/chi phí, gồm ít nhất một bài Task 1 có ảnh (phải đi Gemini) và một bài Task 1 không ảnh (đi GPT). `depends: T003`
- [ ] T005 Review độc lập (CR/SA) và cập nhật verification. `depends: T003`
