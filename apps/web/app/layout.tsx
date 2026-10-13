import type { Metadata } from 'next';
import { BRAND } from '@cutling/shared';
import './globals.css';

export const metadata: Metadata = { title: `${BRAND.name} — 검색에서 배움으로`, description: '학습 목적에 맞는 자료를 찾고, 출처가 연결된 요약과 나만의 학습 로드맵으로 이어 가세요.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body>{children}</body></html>; }
