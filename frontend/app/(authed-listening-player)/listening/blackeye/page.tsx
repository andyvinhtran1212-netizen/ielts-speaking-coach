import type { Metadata } from 'next';
import { BlackEyeUnitList } from '@/components/listening-blackeye';

export const metadata: Metadata = { title: 'Black Eye · Unit 1 — Aver Learning', robots: { index: false, follow: false } };
export default function BlackEyeUnitPage() { return <main className="programme-runner"><BlackEyeUnitList /></main>; }
