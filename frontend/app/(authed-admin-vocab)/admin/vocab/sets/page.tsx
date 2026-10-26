import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabularySetList } from './sets-console';
export const metadata = { title: 'Bộ từ theo lớp · Admin', robots: { index: false, follow: false } };
export default function Page() { return <aver-admin-chrome active="vocab"><AdminAccessGate><AdminVocabularySetList /></AdminAccessGate></aver-admin-chrome>; }
