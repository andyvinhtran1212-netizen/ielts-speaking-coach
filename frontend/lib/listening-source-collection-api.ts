import type { ApiGetJson, ApiPostJson } from '@/lib/openapi-contract';
import type { components } from '@/types/api';

export type ListeningSourceCollectionWire = ApiGetJson<'/api/listening/source-collections/80-days'>;
export type ListeningSourceDayWire = ApiGetJson<'/api/listening/source-collections/80-days/days/{day_number}'>;
export type ListeningSourceStudyWire = ApiPostJson<'/api/listening/source-collections/80-days/days/{day_number}/study'>;
export type ListeningSourceBlockWire = components['schemas']['SourceBlock'];
export type ListeningSourceExplanationWire = components['schemas']['SourceExplanation'];
export type ListeningSourceResponseFieldWire = components['schemas']['SourceResponseField'];

export const SOURCE_COLLECTION_PATH = '/listening/ielts/80-days';

export function sourceAudioLabel(status: string): string {
  return ({ available: 'Có audio', partial: 'Audio một phần', missing: 'Thiếu audio', not_expected: 'Tài liệu từ vựng' } as Record<string, string>)[status] || 'Xem tình trạng audio';
}

export function sourceReviewLabel(status: string): string {
  return ({ CONFIRMED: 'Đã xác minh', SUSPECT: 'Đáp án nguồn cần lưu ý', AMBIGUOUS: 'Có nhiều cách hiểu', UNRESOLVED: 'Chưa đủ dữ kiện' } as Record<string, string>)[status] || 'Tự đối chiếu';
}

export function sourceAnswerProvenanceLabel(value: string): string {
  return ({ printed_key_verified: 'Đáp án in đã được đối chiếu', explanation_derived_verified: 'Đáp án suy ra từ giảng giải đã được đối chiếu', editorial_verified: 'Đáp án biên tập đã được đối chiếu', provisional: 'Gợi ý tham khảo còn hạn chế', source_study: 'Tài liệu tự học từ sách' } as Record<string, string>)[value] || 'Nguồn đối chiếu của bài';
}

export function sourcePrintedKeyLabel(tier?: string | null): string {
  if (tier === 'EXPLANATION_DERIVED') return 'Đáp án suy ra từ phần giảng giải';
  if (['PRINTED', 'PRINTED_KEY', 'PRINTED_EMBEDDED_KEY', 'SURVIVING_PRINTED_KEY_PARSED_REVIEW_REQUIRED', 'SURVIVING_PRINTED_KEY_VISUALLY_CHECKED_PAGE'].includes(tier || '')) return 'Đáp án in trong sách';
  return 'Đáp án nguồn cần đối chiếu';
}

export function sourceEvidenceLabel(value: string): string {
  return ({ printed_transcript: 'Transcript in trong sách', source_transcript: 'Transcript nguồn', printed_key: 'Đáp án in trong sách', printed_question: 'Đề in trong sách', source_scan: 'Ảnh trang gốc', audio: 'Audio nguồn', source_study: 'Tài liệu nguồn' } as Record<string, string>)[value] || 'Chứng cứ nguồn';
}
