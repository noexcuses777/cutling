# HCX 연결

공식 문서 확인일: 2026-10-13. 네이티브 CLOVA Studio API를 사용합니다. 초기 개발 검증은 모의 응답으로 수행했고, 이후 2026-10-13 21:31 KST 설치 지원에서 사용자가 서버 환경파일에 입력한 키로 경량 HCX-DASH-002, 추론 HCX-007, 임베딩 v2의 실제 연결 진단이 모두 성공했습니다. 이는 짧은 진단 요청의 성공이며 전체 학습 작업의 품질·비용 평가를 의미하지 않습니다. 키 값은 문서나 번들에 포함하지 않습니다.

서버의 `apps/web/.env.local`에 설정하고 서버를 재시작하세요. 키는 프런트엔드·확장 프로그램·NEXT_PUBLIC 변수·로그에 넣지 않습니다. 아래 키는 빈 값이며 실제 비밀값을 포함하지 않습니다.

```dotenv
AI_MODE=live
HCX_API_KEY=
HCX_BASE_URL=https://clovastudio.stream.ntruss.com
HCX_LIGHT_MODEL=HCX-DASH-002
HCX_REASONING_MODEL=HCX-007
HCX_EMBEDDING_MODEL=embedding-v2
HCX_CHAT_ENDPOINT=/v3/chat-completions/{model}
HCX_EMBEDDING_ENDPOINT=/v1/api-tools/embedding/v2
HCX_REQUEST_TIMEOUT_MS=30000
HCX_MAX_CONCURRENCY=2
HCX_MAX_RETRIES=1
```

모델명은 공식 문서에 나온 예시이며 계정별 사용 권한을 보장하지 않습니다. 현재 계정의 콘솔에서 허용된 모델과 엔드포인트를 확인하세요. 같은 모델을 두 역할에 지정할 수 있지만 모델 계층 분리에 따른 절감 효과를 주장할 수 없습니다. `HCX_EMBEDDING_MODEL=embedding-v2`는 애플리케이션의 연산 식별자입니다. 네이티브 임베딩 v2는 요청 본문의 model 필드를 받지 않으며 엔드포인트가 연산을 선택합니다.

어댑터는 `Authorization: Bearer ...`, `Content-Type: application/json`, 요청별 `X-NCP-CLOVASTUDIO-REQUEST-ID`를 보냅니다. 스트리밍 헤더를 생략하면 JSON 응답을 받습니다. 이전 Gateway 이중 키 인증을 추측해서 사용하지 않습니다. [공식 공통 설정](https://api.ncloud-docs.com/docs/ai-naver-clovastudio-summary)

경량 모델은 `/v3/chat-completions/{model}`에 messages, maxTokens 등을 보냅니다. HCX-DASH-002는 공식 v3 경량 모델입니다. [텍스트 및 이미지 API](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3)

HCX-007을 지정하면 `thinking.effort=low`와 `maxCompletionTokens`를 사용합니다. 이 모델에는 maxTokens를 보내지 않습니다. 추론과 Structured Outputs 동시 사용 제한 때문에 JSON 지시 후 Zod 검증을 수행합니다. `thinkingContent`는 저장·노출하지 않습니다. 모델 추가 시 파라미터 형식은 공식 문서와 함께 어댑터에서 확인해야 합니다. [Thinking API](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-thinking)

임베딩 v2는 `{text}` 하나를 받아 `result.embedding`과 `result.inputTokens`를 반환합니다. 여러 입력은 중복을 제거하고 동시성 제한 아래 호출합니다. chat의 토큰은 `result.usage.promptTokens/completionTokens`를 사용합니다. 제공되지 않은 usage는 `unavailable`과 null로 기록합니다. [임베딩 v2](https://api.ncloud-docs.com/docs/clovastudio-embeddingv2)

설정 화면의 연결 진단은 경량·정밀·임베딩 역할에 실제로 각각 한 번 요청하므로 과금될 수 있습니다. 세 역할 모두 성공해야 verified가 true입니다. 자동 앱 시작 시에는 진단하지 않습니다. 설정 누락, 인증 오류, 모델 미지원, 제한 초과, 타임아웃, 네트워크·스키마 오류는 별도 코드로 분리하고 규칙 기반 기능을 유지합니다. 응답 오류 본문, 키, 필기 원문은 로그에 남기지 않습니다.

이미지는 HCX로 보내지 않습니다. MVP 경로는 로컬 Tesseract OCR → 사용자 수정 → 사용자가 허용한 텍스트만 HCX 정리입니다. 가격은 코드에 내장하지 않습니다. 운영자가 가격·출처·확인일을 설정하지 않으면 사용량만 표시하며 비용과 절감률을 만들지 않습니다.
