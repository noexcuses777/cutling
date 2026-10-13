import { Suspense } from 'react';
import { CutlingApp } from '../../components/cutling-app';
export default function Page() { return <Suspense fallback={<main className="boot-screen">학습 공간을 열고 있어요…</main>}><CutlingApp /></Suspense>; }
