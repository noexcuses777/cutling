import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
const output=new URL('../../../docs/sample-note.png',import.meta.url);
await mkdir(new URL('../../../docs/',import.meta.url),{recursive:true});
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#fffef8"/><g font-family="Malgun Gothic, Arial, sans-serif" fill="#182b42"><text x="65" y="100" font-size="38">선형대수 학습 노트</text><text x="65" y="160" font-size="24">합성 인쇄체 OCR 테스트 · 실제 개인 필기가 아닙니다</text><text x="65" y="265" font-size="36">벡터는 크기와 방향을 갖습니다.</text><text x="65" y="345" font-size="36">행렬은 선형 변환을 나타냅니다.</text><text x="65" y="425" font-size="36">Vector and matrix are basic concepts.</text><text x="65" y="530" font-size="34">질문: 고유값은 왜 필요한가요?</text></g></svg>`;
await sharp(Buffer.from(svg)).png().toFile(output.pathname.replace(/^\/(\w:)/,'$1'));
console.log('docs/sample-note.png created');
