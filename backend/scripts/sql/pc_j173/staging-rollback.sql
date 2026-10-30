-- STAGING ONLY: zjphffoujxkpltixsbzj. CM OK in handoff/content-manager required before COMMIT.
-- PC-J173 rollback: prompt, explanation, payload.solution only. Never change answers or template.
-- Not a numbered migration; never run through the automatic migration runner.
-- Fail closed on row membership, md5 content drift, missing rows or an already-rollbacked repair.
-- Rollback restores content, not updated_at or mock_content_revision (normal triggers remain enabled).
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $pcj173$
DECLARE
    spec jsonb := $expected${
  "paper_id": "97d1ed4f-bcba-4ccf-a0ef-1c943ca6410b",
  "test_code": "MOCK0016-20261005-ILR001-REV01",
  "changes": [
    {
      "id": "a8939a91-9b3e-4e8b-a795-a5df8c12a9ca",
      "before": {
        "id": "a8939a91-9b3e-4e8b-a795-a5df8c12a9ca",
        "q_num": 21,
        "answer": {
          "answer": "sea temperature",
          "alternatives": [
            "ocean temperature"
          ]
        },
        "prompt": "(see summary above)",
        "payload": {
          "solution": {
            "band": 6.5,
            "tips": "Chép cụm hai từ sea temperature ngay sau elevated; không thêm elevated vì đề đã cho sẵn.",
            "steps": "(1) Định vị đoạn B nói về các tác nhân gây tẩy trắng san hô. (2) most significant by far ở tóm tắt tương ứng với by far the most important trong nguồn. (3) Cụm danh từ đứng sau elevated là sea temperature. (4) Điền sea temperature vào ô 21; hai từ, đúng giới hạn không quá hai từ. (5) elevated đã có sẵn trong câu, nên không chép lại từ này.",
            "vocab": [
              "elevated (adj.) = tăng cao",
              "sea temperature (n.) = nhiệt độ nước biển",
              "stressor (n.) = tác nhân gây stress"
            ],
            "paraphrase": "the most significant by far ↔ by far the most important; elevated sea temperature được giữ nguyên nghĩa",
            "skill_code": "LEX",
            "skill_name": "Từ vựng/dạng từ/giới hạn từ",
            "question_text": "Of the various pressures that can cause bleaching, the most significant by far is elevated {{21}}.",
            "trap_analysis": "low salinity, ultraviolet radiation và sediment cũng được liệt kê, nhưng không phải tác nhân quan trọng nhất. Đoạn B nhấn chỉ ocean warming gây tẩy trắng ở quy mô toàn hành tinh. zooxanthellae là tên vi tảo được hỏi ở ô 20, không phải yếu tố gây stress ở ô 21.",
            "source_excerpt": "Bleaching is the cumulative result of stress, of which elevated sea temperature is by far the most important.",
            "source_paragraph": "B"
          }
        },
        "order_num": 8,
        "skill_tag": "vocabulary_in_context",
        "sub_skill": "LEX",
        "created_at": "2026-10-05T10:04:37.215831+00:00",
        "passage_id": "0c7e3b2e-1998-4170-bb65-1bbf831e7461",
        "explanation": "Đoạn B xác định elevated sea temperature là tác nhân quan trọng nhất gây tẩy trắng. most significant by far ở tóm tắt tương ứng với by far the most important; ô 21 cần sea temperature, gồm hai từ.",
        "question_type": "summary_completion"
      },
      "after": {
        "id": "a8939a91-9b3e-4e8b-a795-a5df8c12a9ca",
        "q_num": 21,
        "answer": {
          "answer": "sea temperature",
          "alternatives": [
            "ocean temperature"
          ]
        },
        "prompt": "(see summary above)",
        "payload": {
          "solution": {
            "band": 6.5
          }
        },
        "order_num": 8,
        "skill_tag": "vocabulary_in_context",
        "sub_skill": "LEX",
        "created_at": "2026-10-05T10:04:37.215831+00:00",
        "passage_id": "0c7e3b2e-1998-4170-bb65-1bbf831e7461",
        "explanation": null,
        "question_type": "summary_completion"
      }
    }
  ],
  "guards": [
    {
      "paper_id": "97d1ed4f-bcba-4ccf-a0ef-1c943ca6410b",
      "test_code": "MOCK0016-20261005-ILR001-REV01",
      "row": {
        "id": "802e3eef-1ba7-4ec8-b4e8-c73b8014d78a",
        "q_num": 20,
        "answer": {
          "answer": "zooxanthellae",
          "alternatives": []
        },
        "prompt": "(see summary above)",
        "payload": {
          "solution": {
            "tips": "Bám đúng ô 20 và chép nguyên thuật ngữ khoa học sau called. Không chuyển sang câu tiếp theo nói về sea temperature.",
            "steps": "(1) Tìm cụm microscopic algae trong đoạn A. (2) known as ở tóm tắt tương ứng với called trong bài đọc. (3) Tên ngay sau called là zooxanthellae. (4) Điền nguyên thuật ngữ này vào ô 20; đây là một từ, nằm trong giới hạn không quá hai từ. (5) Kiểm tra ô 20 hỏi tên vi tảo, không hỏi yếu tố gây tẩy trắng ở ô 21.",
            "vocab": [
              "microscopic (adj.) = cực nhỏ, chỉ thấy được dưới kính hiển vi",
              "algae (n.) = tảo",
              "tissue (n.) = mô"
            ],
            "paraphrase": "microscopic algae, known as ... ↔ microscopic algae called zooxanthellae",
            "skill_code": "LEX",
            "skill_name": "Từ vựng/dạng từ/giới hạn từ",
            "question_text": "Coral bleaching occurs when stony corals lose the microscopic algae, known as {{20}}, that supply most of their energy.",
            "trap_analysis": "algae là loại sinh vật đã được cho sẵn trong tóm tắt; ô trống cần tên gọi cụ thể zooxanthellae. sea temperature trả lời ô 21 về yếu tố gây tẩy trắng, nên không thể dùng ở ô 20. Chép đúng dạng thuật ngữ có trong nguồn; không thêm đuôi s.",
            "source_excerpt": "microscopic algae called zooxanthellae, which live within the corals' tissues and supply most of the energy the corals need to grow.",
            "source_paragraph": "A"
          },
          "template": {
            "summary_text": "Coral bleaching occurs when stony corals lose the microscopic algae, known as {{20}}, that supply most of their energy. Of the various pressures that can cause bleaching, the most significant by far is elevated {{21}}. The first major event recognised internationally was triggered by an unusually warm {{22}} in 1998 and killed about 16 per cent of the world's living corals. Bleaching events have since become more frequent. Some species are more vulnerable than others: branching corals such as Acropora suffer more than {{23}} species such as Porites. Researchers in Australia have produced {{24}} corals that can survive temperatures roughly one degree higher than their parents. Other scientists are working on 'designer {{25}}' that could be placed into wild corals. According to IPCC projections, warming of 1.5 °C would cause a further decline of 70 to 90 per cent in coral reefs, with larger losses at 2 °C. The writer concludes that reef survival ultimately depends on faster {{26}} at a global scale."
          }
        },
        "order_num": 7,
        "skill_tag": "vocabulary_in_context",
        "sub_skill": "LEX",
        "created_at": "2026-10-05T10:04:37.215831+00:00",
        "passage_id": "0c7e3b2e-1998-4170-bb65-1bbf831e7461",
        "explanation": "Đoạn A gọi tên vi tảo là zooxanthellae. known as ở ô 20 tương ứng với called trong bài đọc; tên này là một từ và không vượt giới hạn hai từ.",
        "question_type": "summary_completion"
      }
    },
    {
      "paper_id": "cc548c72-11c1-4798-83be-ffaa8db55423",
      "test_code": "MOCK0016-20261006-ILR001-REV02",
      "row": {
        "id": "c1f98c5c-35c9-4762-8456-7803bd27571b",
        "q_num": 20,
        "answer": {
          "answer": "zooxanthellae",
          "alternatives": []
        },
        "prompt": "(see summary above)",
        "payload": {
          "solution": {
            "tips": "Bám đúng ô 20 và chép nguyên thuật ngữ khoa học sau called. Không chuyển sang câu tiếp theo nói về sea temperature.",
            "steps": "(1) Tìm cụm microscopic algae trong đoạn A. (2) known as ở tóm tắt tương ứng với called trong bài đọc. (3) Tên ngay sau called là zooxanthellae. (4) Điền nguyên thuật ngữ này vào ô 20; đây là một từ, nằm trong giới hạn không quá hai từ. (5) Kiểm tra ô 20 hỏi tên vi tảo, không hỏi yếu tố gây tẩy trắng ở ô 21.",
            "vocab": [
              "microscopic (adj.) = cực nhỏ, chỉ thấy được dưới kính hiển vi",
              "algae (n.) = tảo",
              "tissue (n.) = mô"
            ],
            "paraphrase": "microscopic algae, known as ... ↔ microscopic algae called zooxanthellae",
            "skill_code": "LEX",
            "skill_name": "Từ vựng/dạng từ/giới hạn từ",
            "question_text": "Coral bleaching occurs when stony corals lose the microscopic algae, known as {{20}}, that supply most of their energy.",
            "trap_analysis": "algae là loại sinh vật đã được cho sẵn trong tóm tắt; ô trống cần tên gọi cụ thể zooxanthellae. sea temperature trả lời ô 21 về yếu tố gây tẩy trắng, nên không thể dùng ở ô 20. Chép đúng dạng thuật ngữ có trong nguồn; không thêm đuôi s.",
            "source_excerpt": "microscopic algae called zooxanthellae, which live within the corals' tissues and supply most of the energy the corals need to grow.",
            "source_paragraph": "A"
          },
          "template": {
            "summary_text": "Coral bleaching occurs when stony corals lose the microscopic algae, known as {{20}}, that supply most of their energy. Of the various pressures that can cause bleaching, the most significant by far is elevated {{21}}. The first major event recognised internationally was triggered by an unusually warm {{22}} in 1998 and killed about 16 per cent of the world's living corals. Bleaching events have since become more frequent. Some species are more vulnerable than others: branching corals such as Acropora suffer more than {{23}} species such as Porites. Researchers in Australia have produced {{24}} corals that can survive temperatures roughly one degree higher than their parents. Other scientists are working on 'designer {{25}}' that could be placed into wild corals. According to IPCC projections, warming of 1.5 °C would cause a further decline of 70 to 90 per cent in coral reefs, with larger losses at 2 °C. The writer concludes that reef survival ultimately depends on faster {{26}} at a global scale."
          }
        },
        "order_num": 7,
        "skill_tag": "vocabulary_in_context",
        "sub_skill": "LEX",
        "created_at": "2026-10-06T05:30:49.825844+00:00",
        "passage_id": "e70f74c6-62d3-4838-9b7f-b380701bb244",
        "explanation": "Đoạn A gọi tên vi tảo là zooxanthellae. known as ở ô 20 tương ứng với called trong bài đọc; tên này là một từ và không vượt giới hạn hai từ.",
        "question_type": "summary_completion"
      }
    },
    {
      "paper_id": "cc548c72-11c1-4798-83be-ffaa8db55423",
      "test_code": "MOCK0016-20261006-ILR001-REV02",
      "row": {
        "id": "e3ac5635-b2ec-4793-9001-95e5611c5191",
        "q_num": 21,
        "answer": {
          "answer": "sea temperature",
          "alternatives": [
            "ocean temperature"
          ]
        },
        "prompt": "(see summary above)",
        "payload": {
          "solution": {
            "band": 6.5,
            "tips": "Chép cụm hai từ sea temperature ngay sau elevated; không thêm elevated vì đề đã cho sẵn.",
            "steps": "(1) Định vị đoạn B nói về các tác nhân gây tẩy trắng san hô. (2) most significant by far ở tóm tắt tương ứng với by far the most important trong nguồn. (3) Cụm danh từ đứng sau elevated là sea temperature. (4) Điền sea temperature vào ô 21; hai từ, đúng giới hạn không quá hai từ. (5) elevated đã có sẵn trong câu, nên không chép lại từ này.",
            "vocab": [
              "elevated (adj.) = tăng cao",
              "sea temperature (n.) = nhiệt độ nước biển",
              "stressor (n.) = tác nhân gây stress"
            ],
            "paraphrase": "the most significant by far ↔ by far the most important; elevated sea temperature được giữ nguyên nghĩa",
            "skill_code": "LEX",
            "skill_name": "Từ vựng/dạng từ/giới hạn từ",
            "question_text": "Of the various pressures that can cause bleaching, the most significant by far is elevated {{21}}.",
            "trap_analysis": "low salinity, ultraviolet radiation và sediment cũng được liệt kê, nhưng không phải tác nhân quan trọng nhất. Đoạn B nhấn chỉ ocean warming gây tẩy trắng ở quy mô toàn hành tinh. zooxanthellae là tên vi tảo được hỏi ở ô 20, không phải yếu tố gây stress ở ô 21.",
            "source_excerpt": "Bleaching is the cumulative result of stress, of which elevated sea temperature is by far the most important.",
            "source_paragraph": "B"
          }
        },
        "order_num": 8,
        "skill_tag": "vocabulary_in_context",
        "sub_skill": "LEX",
        "created_at": "2026-10-06T05:30:49.825844+00:00",
        "passage_id": "e70f74c6-62d3-4838-9b7f-b380701bb244",
        "explanation": "Đoạn B xác định elevated sea temperature là tác nhân quan trọng nhất gây tẩy trắng. most significant by far ở tóm tắt tương ứng với by far the most important; ô 21 cần sea temperature, gồm hai từ.",
        "question_type": "summary_completion"
      }
    }
  ]
}$expected$::jsonb;
    e jsonb;
    actual jsonb;
    paper_before jsonb;
    paper_after jsonb;
    rows_before jsonb;
    rows_after jsonb;
    changed integer := 0;
    row_count integer;
BEGIN
    -- Same advisory lock used by the live paper-source trigger (migration 306).
    PERFORM public.fn_lock_mock_paper('reading', (spec->>'paper_id')::uuid);
    SELECT to_jsonb(t) INTO paper_before FROM public.reading_tests t
      WHERE t.id = (spec->>'paper_id')::uuid AND t.test_id = spec->>'test_code'
        AND t.status = 'published' AND t.exam_only = true AND t.is_public = false
      FOR UPDATE;
    IF paper_before IS NULL THEN
        RAISE EXCEPTION 'PC-J173: missing/mismatched target paper; wrong environment or state';
    END IF;
    -- Lock the complete target paper, including neighbouring Q19/Q22, before the snapshot.
    PERFORM q.id FROM public.reading_questions q
      JOIN public.reading_passages p ON p.id = q.passage_id
      WHERE p.test_id = (spec->>'paper_id')::uuid ORDER BY q.id FOR UPDATE OF q;
    SELECT jsonb_object_agg(q.id::text, to_jsonb(q) - 'updated_at') INTO rows_before
      FROM public.reading_questions q JOIN public.reading_passages p ON p.id = q.passage_id
      WHERE p.test_id = (spec->>'paper_id')::uuid;

    -- Pin REV02 provenance and (on staging) the already-correct Q20. No source rows are written.
    FOR e IN SELECT value FROM jsonb_array_elements(spec->'guards') LOOP
        SELECT to_jsonb(q) - 'updated_at' INTO actual FROM public.reading_questions q
          JOIN public.reading_passages p ON p.id = q.passage_id
          JOIN public.reading_tests t ON t.id = p.test_id
          WHERE q.id = (e->'row'->>'id')::uuid AND q.q_num = (e->'row'->>'q_num')::integer
            AND p.passage_order = 2 AND t.id = (e->>'paper_id')::uuid
            AND t.test_id = e->>'test_code';
        IF actual IS NULL OR md5(actual::text) IS DISTINCT FROM md5((e->'row')::text) THEN
            RAISE EXCEPTION 'PC-J173: source/Q20 guard md5 mismatch for %', e->'row'->>'id';
        END IF;
    END LOOP;
    -- Check ALL target preconditions before the first UPDATE; nulls are part of the hash.
    FOR e IN SELECT value FROM jsonb_array_elements(spec->'changes') LOOP
        SELECT to_jsonb(q) - 'updated_at' INTO actual FROM public.reading_questions q
          JOIN public.reading_passages p ON p.id = q.passage_id
          WHERE q.id = (e->>'id')::uuid AND q.q_num = (e->'before'->>'q_num')::integer
            AND p.passage_order = 2 AND p.test_id = (spec->>'paper_id')::uuid;
        IF actual IS NULL OR md5(actual::text) IS DISTINCT FROM md5((e->'before')::text) THEN
            RAISE EXCEPTION 'PC-J173: target precondition md5 mismatch for %; nothing may be resent blindly', e->>'id';
        END IF;
        IF ((e->'before') - ARRAY['prompt','explanation','payload']) IS DISTINCT FROM
               ((e->'after') - ARRAY['prompt','explanation','payload'])
           OR ((e->'before'->'payload') - 'solution') IS DISTINCT FROM
               ((e->'after'->'payload') - 'solution') THEN
            RAISE EXCEPTION 'PC-J173: repair attempts to change answers, template or another protected field';
        END IF;
    END LOOP;
    FOR e IN SELECT value FROM jsonb_array_elements(spec->'changes') LOOP
        UPDATE public.reading_questions SET
            prompt = e->'after'->>'prompt',
            explanation = e->'after'->>'explanation',
            payload = e->'after'->'payload'
          WHERE id = (e->>'id')::uuid;
        GET DIAGNOSTICS row_count = ROW_COUNT;
        changed := changed + row_count;
        rows_before := jsonb_set(rows_before, ARRAY[e->>'id'], e->'after', false);
    END LOOP;
    SELECT jsonb_object_agg(q.id::text, to_jsonb(q) - 'updated_at') INTO rows_after
      FROM public.reading_questions q JOIN public.reading_passages p ON p.id = q.passage_id
      WHERE p.test_id = (spec->>'paper_id')::uuid;
    SELECT to_jsonb(t) INTO paper_after FROM public.reading_tests t WHERE t.id = (spec->>'paper_id')::uuid;
    IF changed <> jsonb_array_length(spec->'changes') OR rows_after IS DISTINCT FROM rows_before THEN
        RAISE EXCEPTION 'PC-J173: postcondition failed: count/content/answers/template/neighbour drift';
    END IF;
    IF (paper_after - ARRAY['updated_at','mock_content_revision']) IS DISTINCT FROM
           (paper_before - ARRAY['updated_at','mock_content_revision'])
       OR (paper_after->>'mock_content_revision')::bigint < (paper_before->>'mock_content_revision')::bigint THEN
        RAISE EXCEPTION 'PC-J173: postcondition failed: unexpected paper/policy mutation';
    END IF;
    RAISE NOTICE 'PC-J173 staging rollback PASS: % question(s); answers, templates and neighbours preserved', changed;
END $pcj173$;
COMMIT;
