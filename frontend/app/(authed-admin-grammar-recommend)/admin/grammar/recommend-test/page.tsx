import type { Metadata } from 'next';
import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminGrammarRecommend } from './admin-grammar-recommend';
export const metadata: Metadata = { title: 'Grammar recommendation lab · Admin', robots: { index: false, follow: false } };
export default function Page() { return <aver-admin-chrome active="grammar" subsection="recommend-test"><AdminAccessGate><AdminGrammarRecommend /></AdminAccessGate></aver-admin-chrome>; }
