# 데이터 흐름

웹(Next.js App Router) → 동일 출처 API → HttpOnly 세션 → ownerId 범위 Prisma/SQLite. 확장 content script → service worker → 제한된 Bearer 토큰 → 같은 API/DB → 서버 전용 HCX. 브리지는 연결 상태와 네이버 탭 열기 두 동작만 전달합니다.

프로젝트 생성 시 목적·수준·필터·모드를 저장하고 초안을 만듭니다. 웹 검색은 세션을 생성하고 연결된 확장이 실제 네이버 탭과 프로젝트를 내부에서 연결합니다. 네이버 DOM 어댑터는 보이는 블록만 제한된 배치로 읽습니다. 규칙 결과를 먼저 표시한 후 live 작업을 polling합니다. query/intent 변경은 요청 버전을 증가시켜 이전 결과를 무시합니다.

자료는 DB 저장 → 작업 큐 → 명시적으로 요청된 본문 수집 → 3줄 요약·문단 근거 → 짧은 debounce 로드맵 갱신입니다. 원문을 매번 보내지 않고 구조화 요약/개념을 재사용합니다. 단계 변경 시 사용자 메모/완료를 보존하고 이전 버전을 저장합니다. 저장은 프로젝트별 URL 중복을 확인합니다.

노트 이미지 → 실제 형식 검사/재인코딩 → private 파일 저장 → Tesseract 한국어+영어 OCR → 사용자 검토 → 동의한 텍스트만 HCX/규칙 정리 → 필기 자료와 로드맵 연결입니다. HCX가 이미지 OCR을 했다고 표시하지 않습니다.

DB는 `Workspace`, `Credential`, `Entity` 세 관계형 테이블을 사용합니다. Entity의 `kind`는 project/session/result/resource/roadmap/roadmapVersion/note/modelCall/event/job/benchmark/settings/diagnostic, 내용은 공유 타입과 API Zod를 따른 JSON입니다. `ownerId`, `projectId`, `parentId`를 별도 열로 두어 접근 경계와 조회 인덱스를 유지합니다. 과도한 테이블/마이그레이션을 줄인 로컬 MVP 선택입니다.

작업 상태는 DB에 남습니다. 프로세스 재시작 후 첫 인증 API 요청에서 중단 작업을 재대기시키고 하나씩 실행합니다. 같은 자료·같은 종류의 대기/처리 작업은 중복 enqueue하지 않습니다. 종료 직전 HCX 요청은 재시도될 수 있어 비용 측면의 exactly-once는 보장하지 않습니다. 삭제된 엔터티에는 늦은 결과를 반영하지 않습니다. 이 큐는 다중 프로세스/서버리스에 적합하지 않습니다.
