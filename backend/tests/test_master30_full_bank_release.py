"""Golden release checks against the real independently reviewed full banks."""
import json

from services.grammar_lesson_content import PRACTICE_ROOT, load_version, public_lesson
from services.grammar_lesson_full_content import question_counts, _sha, _review_full_read


EXTRAS = {14: 1, 15: 4, 16: 5, 17: 5, 19: 2, 20: 3, 21: 10,
          22: 1, 23: 9, 24: 10, 25: 10, 26: 20, 27: 10, 29: 10}


def test_actual_all_thirty_release_preserves_original_inventory_and_feedback_secrecy():
    package = load_version('v3')
    manifest = json.loads((PRACTICE_ROOT / 'v3.json').read_text())
    review = json.loads((PRACTICE_ROOT / 'v3-review.json').read_text())
    assert review['decision'] == 'approved'
    assert len(package['lessons']) == 30
    total = objective = writing = 0
    for number in range(1, 31):
        lid = f'M30-B{number:02d}'
        lesson = package['lessons'][lid]
        questions = lesson['questions']
        counts = question_counts(lesson)
        assert counts['objective_count'] == 90
        assert counts['core_count'] == 100
        assert counts['writing_count'] == 10 + EXTRAS.get(number, 0)
        assert counts['supplementary_count'] == EXTRAS.get(number, 0)
        assert _sha([q['id'] for q in questions]) == manifest['lessons'][lid]['original_ids_sha256']
        assert _review_full_read(review['lessons'][lid], len(questions), counts['writing_count'])
        before = public_lesson(lesson)['questions']
        assert all(not set(q).intersection({
            'correct_index', 'explanation', 'writing_feedback', 'model_answer',
            'source_record', 'distractor_explanations',
        }) for q in before)
        for original, public in zip(questions, before):
            assert original['source_record']['id'] == public['id']
            if original['type'] == 'writing':
                assert public['output_requirements'] == original['source_record']['yeu_cau_dau_ra']
        answers = {
            q['id']: {'answer_text': '  My response.\nLý do: giữ nguyên ý.  '}
            if q['type'] == 'writing' else {
                'selected_index': q['correct_index'], 'is_correct': True,
            } for q in questions
        }
        after = public_lesson(lesson, answers)['questions']
        for original, public in zip(questions, after):
            assert public['explanation'] == original['source_record']['giai_thich']
            if original['type'] == 'writing':
                assert public['answer_text'] == answers[public['id']]['answer_text']
                assert 'is_correct' not in public and 'correct_index' not in public
                feedback = public['writing_feedback']
                assert feedback['model_answer'] == original['source_record']['dap_an_mau']
                assert feedback['accepted_variants'] == original['source_record']['bien_the_chap_nhan']
                assert feedback['detailed_rubric'] == original['source_record']['tieu_chi_chi_tiet']
            else:
                assert public['correct_index'] == original['source_record']['dap_an']
                assert public['distractor_explanations'] == original['source_record']['bay']
        total += len(questions)
        objective += counts['objective_count']
        writing += counts['writing_count']
    assert (total, objective, writing) == (3100, 2700, 400)
