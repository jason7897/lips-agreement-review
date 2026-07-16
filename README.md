# LIPS 협약 사업계획서 검토 도구

중기부에서 제정/개정한 LIPS(혁신 소상공인 투자연계지원) 운영지침(사업비 집행기준 등)을 학습시켜두고,
협약 절차 중 제출된 사업계획서를 올리면 지침에 비추어 **수정이 필요한 항목 / 지침상 불가능한 항목**을
1차로 걸러주는 로컬 도구입니다.

- 팀원 각자 자기 PC에 클론해서 실행합니다 (서버 비용 없음, 데이터는 각자 로컬에만 저장됩니다).
- PDF / 한글(HWP, HWPX) 문서를 모두 지원합니다.
- LLM은 Groq 무료 API를 사용합니다 (신용카드 없이 무료 API 키 발급 가능).
- **참고용 1차 검토 도구입니다.** 최종 판단은 반드시 담당자가 직접 확인하세요.

## 처음 설치하는 방법

1. 파이썬 3.10 이상 설치 ([python.org](https://www.python.org/downloads/) 에서 "Add to PATH" 체크하고 설치)
2. 이 저장소를 원하는 폴더에 클론
   ```
   git clone <저장소 URL>
   cd lips-agreement-review
   ```
3. 가상환경 생성 및 패키지 설치
   ```
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   ```
4. Groq API 키 발급받기
   - https://console.groq.com 에서 무료 가입 후 API Key 발급
5. `.env.example` 파일을 복사해서 `.env` 파일을 만들고, 발급받은 키를 넣기
   ```
   copy .env.example .env
   ```
   `.env` 내용:
   ```
   GROQ_API_KEY=발급받은_키_붙여넣기
   REVIEW_MODEL=llama-3.3-70b-versatile
   ```
6. 서버 실행
   ```
   uvicorn app:app --reload
   ```
7. 브라우저에서 http://127.0.0.1:8000 접속

## 사용 방법

1. **"지침 관리"** 탭에서 사업비 관리지침, 운영지침 등 PDF/HWP 파일을 업로드 (여러 개 누적 가능)
2. **"사업계획서 검토"** 탭에서 검토할 사업계획서 파일을 업로드 → "검토 시작" 클릭
3. 항목별로 `적합 / 수정필요 / 불가` 판정과 근거 지침 조항, 수정 제안이 표시됨
4. **"검토 이력"** 탭에서 과거 검토 결과를 다시 확인 가능

## 다음에 실행할 때

```
cd lips-agreement-review
venv\Scripts\activate
uvicorn app:app --reload
```

## 구조

- `app.py` — FastAPI 엔드포인트
- `extract.py` — PDF/HWP/HWPX 텍스트 추출
- `sections.py` — 조항/항목 단위 텍스트 분할
- `db.py` — SQLite 저장 + 관련도 검색 (임베딩 없이 bigram 유사도 방식, 무료)
- `llm.py` — Groq LLM 호출 및 판정 로직
- `static/index.html` — 프론트엔드 (바닐라 JS, 별도 빌드 불필요)

## 주의사항

- `review.db`(로컬 SQLite)와 `.env`는 git에 커밋되지 않습니다(`.gitignore` 처리) — 각자 로컬에 남습니다.
- 지침 문서는 팀원마다 각자 업로드해서 학습시켜야 합니다 (DB가 공유되지 않음, 완전 로컬).
- 스캔본(이미지) PDF는 텍스트 추출이 안 될 수 있습니다 — 텍스트 레이어가 있는 PDF/HWP만 지원합니다.
