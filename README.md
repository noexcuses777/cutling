# Cutling / 커틀링

**네이버 검색에서 광고와 관련 없는 결과를 접고, 필요한 자료를 저장합니다.**

공부 자료를 찾다가 홍보·후기·중복 정보를 오가고, 찾은 자료도 다시 읽어 정리해야 하는 부담을 줄이기 위한 로컬 MVP입니다. 학습 목적에 따라 검색 결과의 주목도를 조절하고, 직접 고른 자료를 출처가 연결된 요약·학습 로드맵·필기로 이어 줍니다. 유료 자료를 나쁜 정보로 단정하거나 집중력 문제를 진단하지 않습니다.

## 실행

필요 환경: Node.js 22.12 이상(검증 환경 24.11), pnpm 11.25, Chrome. **로컬 Node 서버와 영속 SQLite DB**를 사용합니다. 서버리스/공개 배포 구성은 포함하지 않습니다.

Windows PowerShell에서 `pnpm`을 찾지 못하면 먼저 아래 명령으로 설치하세요. Codex 내부에서 제공하는 pnpm 경로는 일반 PowerShell에 자동으로 적용되지 않습니다. `.cmd`를 사용하면 PowerShell 스크립트 실행 정책에 따른 차단도 피할 수 있습니다.

```powershell
node --version
npm.cmd install --global pnpm@11.25.0
pnpm.cmd --version
```

설치 후에도 명령을 찾지 못하면 PowerShell을 닫고 다시 여세요. 아래 실행 명령의 `pnpm`은 Windows에서 `pnpm.cmd`로 바꿔 실행할 수 있습니다.

```powershell
cd <이 폴더 경로>
pnpm install
Copy-Item apps/web/.env.example apps/web/.env.local
pnpm db:generate
pnpm db:migrate
pnpm dev
```

[http://localhost:3000](http://localhost:3000)을 여세요. 기본 서버는 `127.0.0.1`에만 바인딩됩니다. 같은 워크스페이스를 계속 사용하려면 같은 브라우저와 주소(localhost 또는 127.0.0.1)를 사용하세요. 브라우저별 HttpOnly 쿠키로 로컬 사용자를 분리하며 DB에는 세션 토큰의 해시만 저장합니다.

Prisma CLI는 `prisma.config.ts`에서 `.env.local`을 읽습니다. 기본 DB는 `apps/web/prisma/cutling.db`, 업로드/OCR 캐시는 `apps/web/data/`입니다. 이 경로와 `.env.local`은 Git에서 제외합니다. `pnpm db:migrate`는 버전 관리된 초기 마이그레이션을 적용합니다. 홈의 **샘플 프로젝트**는 현재 브라우저 워크스페이스에 명시적인 데모를 만듭니다. `pnpm db:seed`는 실행 중인 서버에 별도 CLI 데모 워크스페이스를 만듭니다(브라우저용은 홈 버튼 권장).

프로덕션 빌드도 로컬에서 실행할 수 있습니다. Windows에서는 먼저 실행 중인 개발 서버를 `Ctrl+C`로 종료하세요. 실행 중인 Prisma 엔진 파일은 재생성할 수 없습니다.

```powershell
pnpm build
pnpm start
```

## 구성과 구현 범위

| 경로 | 역할 |
|---|---|
| `apps/web/app` | 홈, 프로젝트, 아카이브/상세, 로드맵, 필기, 리포트, 설정 |
| `apps/web/app/api/[...path]/route.ts` | 검증·소유권 확인이 있는 REST API |
| `apps/web/server` | DB, 연결 인증, 공개 본문 추출, 작업 큐, OCR, 집계 |
| `apps/web/prisma` | SQLite 스키마와 마이그레이션 |
| `apps/extension` | Manifest V3 worker, content script, popup/options, 웹 브리지 |
| `packages/shared` | 브랜드, 공유 타입/Zod, 규칙 분류, URL 정규화, 로드맵, 지표 |
| `packages/ai` | 서버 전용 HCX 클라이언트, 프롬프트, 라우팅·캐시·폴백 |
| `packages/search-adapters` | 네이버 DOM 추출·동적 처리·버전 가드 |
| `fixtures`, `tests` | 합성 데이터, 보안/단위/브라우저 테스트 |

브랜드 이름은 `packages/shared/src/types.ts`의 `BRAND`에서 수정합니다. 확장 프로그램을 다시 빌드하면 manifest와 화면에도 반영됩니다.

프로젝트 생성 → 네이버 검색 세션 → 확장 프로그램의 화면 결과 추출 → 규칙 1차 분류 → live 모드의 후속 AI 작업 → 자료 저장 → 비동기 요약 → 출처 연결 로드맵 → 다음 검색 → 필기 → 실제 이벤트/사용량 리포트가 같은 DB를 사용합니다. 저장 자료는 새로고침 후에도 유지됩니다. 검색 결과 원본을 삭제하지 않고 다시 보기/필터 끄기를 제공합니다.

## 크롬 확장 설치·연결

```powershell
pnpm build:extension
```

1. Chrome의 `chrome://extensions`에서 개발자 모드를 켭니다.
2. **압축해제된 확장 프로그램을 로드합니다** → `apps/extension/dist` 선택.
3. 네이버 검색 탭을 새로고침합니다. **기본 필터는 연결 코드나 프로젝트 없이 바로 작동합니다.**
4. 자료도 저장하려면 웹 서비스 **설정 → 연결 코드 발급**에서 5분 유효 일회성 코드를 발급합니다.
5. 확장 프로그램 옵션을 열어 서버 주소 `http://localhost:3000`과 코드를 입력합니다. 클로바 API 키를 넣는 칸이 아닙니다.
6. 웹에서 프로젝트를 만들고 **네이버에서 검색**을 누르거나, 네이버 커틀링 패널에서 저장할 프로젝트를 선택합니다.
7. 검색 결과에서 자료를 담고 웹 아카이브에서 확인합니다.

**이미 설치했다면:** 파일을 갱신한 뒤 `chrome://extensions`의 Cutling 카드에서 새로고침(원형 화살표)을 누르고 네이버 탭도 새로고침합니다. 확장 버전은 **0.2.0**입니다. 개발자 도구 Sources의 워크스페이스에 추가할 필요가 없습니다.

확장 프로그램이 없으면 실제 네이버 검색은 열리지만 필터링이 켜졌다고 표시하지 않습니다. 프로젝트 문맥은 확장 내부 탭 매핑에 보관하며 네이버 URL에는 검색어만 보냅니다. 임의 사이트 상시 권한을 요청하지 않습니다. 지원 네이버 블로그 페이지는 popup의 **이 페이지 담기**로 현재 DOM을 명시적으로 저장할 수 있습니다. 다른 사이트는 URL/본문 입력을 사용하세요. 자세한 설치·수동 검증은 [확장 문서](docs/extension.md)를 보세요.

## 모드와 실제 HCX 연결

| 모드 | 실제 동작 |
|---|---|
| rules (기본) | 광고 표식·키워드·목적·날짜·URL/문자열 중복 규칙, 근거 발췌 요약. 임베딩 없음 |
| live | 서버 HCX 임베딩·경량·정밀 역할 호출. 실패 시 규칙 폴백을 명시하고 데모로 바꾸지 않음 |
| demo | 명시적 합성 샘플 프로젝트/자료/분류. 실제 HCX 호출·사용량으로 표시하지 않음 |

`AI_MODE`는 기본값, `ALLOWED_AI_MODES`는 운영자가 허용할 모드입니다. 설정 화면의 변경은 **새 프로젝트**에 적용합니다. 기존 프로젝트는 해당 모드를 유지해 실사용과 데모 지표를 섞지 않습니다.

`apps/web/.env.local`의 **서버 전용** 변수에 재발급한 키를 입력하세요. 실제 키는 코드, 확장 번들, `NEXT_PUBLIC_*`, 로그에 넣지 않습니다.

```dotenv
HCX_API_KEY=<본인의 서버 전용 키>
HCX_BASE_URL=https://clovastudio.stream.ntruss.com
HCX_LIGHT_MODEL=HCX-DASH-002
HCX_REASONING_MODEL=HCX-007
HCX_EMBEDDING_MODEL=embedding-v2
HCX_CHAT_ENDPOINT=/v3/chat-completions/{model}
HCX_EMBEDDING_ENDPOINT=/v1/api-tools/embedding/v2
HCX_REQUEST_TIMEOUT_MS=15000
HCX_MAX_CONCURRENCY=2
AI_MODE=live
```

위 모델/경로는 2026-10-13 확인한 공식 문서 예시이며 **계정별 접근 권한은 별도 확인**해야 합니다. OpenAI 호환 API라고 가정하지 않고 HCX 고유 요청·응답을 처리합니다. HCX-007의 `thinking`/`maxCompletionTokens`와 경량 모델 `maxTokens`를 구분합니다. 설정 후 서버를 재시작하고 **설정 → 연결 진단**을 누르세요. 이 진단은 역할별 실제 요청을 보내므로 계정 요금이 발생할 수 있습니다. 세 역할 성공 후에만 연결 검증 완료로 표시합니다.

초기 개발은 실제 키 없이 모의 HTTP 응답으로 검증했습니다. 이후 **2026-10-13 설치 지원에서 사용자 서버 키로 경량·정밀·임베딩 세 역할의 실제 연결 진단에 성공했습니다.** 전체 학습 작업의 품질·비용 평가는 별도입니다. 다른 환경에서는 본인의 키를 설정하고 연결 진단을 실행하세요. 공식 문서·필드·오류·제약은 [HCX 연결 문서](docs/hcx.md), 라우팅은 [AI 문서](docs/ai-routing.md)에 있습니다.

## 저장·요약·필기

URL 입력, 클립보드 URL, 본문 붙여넣기, 네이버 검색 결과 담기, 지원 페이지 현재 DOM 담기를 제공합니다. 자료는 먼저 저장하고 비동기 작업으로 처리합니다. 공개 본문 수집은 저장 요청 시에만 실행하며 최대 1MB/12초/리다이렉트 3회입니다. 접근 제한을 우회하지 않습니다. 본문을 못 가져와도 제목/검색 요약과 한계를 저장합니다. 요약은 정확히 3줄이며 확보 문단 ID를 연결합니다. 근거가 부족하면 부족하다고 표시합니다. 원문/모델 HTML을 실행하지 않습니다.

필기는 JPG/PNG/WEBP 5MB 이하, 1회 1장입니다. Sharp로 실제 형식을 확인하고 회전·재인코딩하여 메타데이터를 제거합니다. Tesseract `kor+eng`가 **로컬 CPU**에서 OCR을 합니다. 첫 실행은 공개 언어 데이터를 다운로드하며 이미지 자체를 외부 OCR로 보내지 않습니다. 네트워크가 없거나 필기체·수식 인식이 어려우면 원본을 보며 텍스트를 직접 수정하세요. 원본 보관을 끄면 OCR 후 이미지를 삭제합니다. live 정리는 검토된 텍스트만 HCX로 전송하며 별도 동의를 받습니다. 저장된 필기 정리는 아카이브와 학습 단계/다음 검색에 연결됩니다.

## 리포트와 벤치마크

실제 저장/분석/펼치기 이벤트를 집계합니다. 검토 생략 45초/건, 자료 수동 정리 180초/건은 **제품 가정**이며 설정에서 바꿀 수 있습니다. 다시 펼친 결과는 탐색 추정에서 제외하며 중복 후보 수를 이중으로 더하지 않습니다. 실제 행동 시간 측정값이 아닙니다.

토큰은 API 제공값과 미제공을 구분하고 미제공을 0 사용처럼 표시하지 않습니다. 가격 설정·동일 조건 baseline이 없으면 비용/절감률을 표시하지 않습니다. `MODEL_PRICING_JSON` 형식과 계산은 [지표 문서](docs/metrics.md)에 있습니다.

```powershell
pnpm benchmark
```

이 스크립트와 리포트 버튼은 **유료 요청 없는 합성 fixture 규칙 평가**입니다. 실제 HCX 전체 추론 baseline 비교는 구현되지 않았으며 `unavailable`입니다. 작은 fixture 정확도를 네이버 전체 정확도로 주장하지 않습니다.

## 개발·검증 명령

```powershell
pnpm dev:web
pnpm dev:extension
pnpm typecheck
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

확장 watch 모드는 빌드 결과를 갱신합니다. Chrome 확장 관리에서 새로고침이 필요합니다. 테스트 결과와 미검증 범위는 [검증 결과](docs/verification.md)에 기록합니다. E2E는 별도 브라우저 워크스페이스를 사용합니다.

## 보안·삭제·제약

- 모든 도메인 레코드는 ownerId와 프로젝트 범위로 검증합니다. 연결 코드는 5분·1회, 확장 토큰은 30일 만료이며 폐기할 수 있습니다. 일반 웹 브리지에 토큰을 노출하지 않습니다.
- 본문 수집은 DNS와 각 리다이렉트 주소를 검사하고 검증한 IP에 연결을 고정합니다. 사설망·루프백·메타데이터·비HTTP 주소를 차단합니다.
- 설정의 **데이터 삭제**는 현재 워크스페이스 자료·노트 이미지·프로젝트·보고 로그·확장 연결을 삭제합니다. 로컬 OCR 공개 언어 캐시는 개인 자료가 아닙니다.
- 로드맵은 일반 학습 제안과 저장 자료의 연결을 구분합니다. 사용자 완료/메모와 이전 로드맵 버전을 보존합니다. 의미적 연결은 오분류될 수 있습니다.
- 실환경 Chrome+네이버 검증 여부, OCR·API 연결 제약을 [검증 결과](docs/verification.md)에서 확인하세요. 네이버 DOM 변경 시 어댑터 수정이 필요할 수 있습니다.
- 공개 서비스용 로그인, 다중 서버 작업 큐, Chrome 웹스토어 배포, 정교한 수식 OCR, 유료 HCX baseline 자동 실행은 포함하지 않습니다. 로컬 단일 프로세스 MVP입니다.
- 모델 출력 검증은 구조/근거 ID 검증이며 사실성의 완전한 보장이 아닙니다. 요약과 원문을 함께 확인할 수 있습니다.

[구조](docs/architecture.md) · [보안](docs/security.md) · [데모 순서](docs/demo.md) · [실행 검증](docs/verification.md)
