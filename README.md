# LIPS 협약 사업계획서 검토 도구

중기부에서 제정/개정한 LIPS(혁신 소상공인 투자연계지원) 운영지침(사업비 집행기준 등)을 학습시켜두고,
협약 절차 중 제출된 사업계획서를 올리면 지침에 비추어 **수정이 필요한 항목 / 지침상 불가능한 항목**을
1차로 걸러줍니다.

**참고용 1차 검토 도구입니다.** 최종 판단은 반드시 담당자가 직접 확인하세요.

이 저장소에는 두 가지 버전이 있습니다. 대부분은 **1번(설치 없는 버전)**으로 충분합니다.

## 1. 설치 없는 버전 — `lips-review.html` (추천)

파일 하나만 받아서 더블클릭하면 바로 열리는 버전입니다. 파이썬 설치, 서버 실행 다 필요 없습니다.

- 사용법
  1. `lips-review.html` 파일을 받아서 아무 폴더에나 저장 (카톡/메신저로 전달받은 파일이어도 됨)
  2. 더블클릭해서 브라우저로 열기
  3. 우측 상단 **"Groq API 키 설정"** 클릭 → https://console.groq.com 에서 무료로 발급받은 키 입력 (이 브라우저에만 저장되고 어디로도 전송되지 않음, Groq 호출 시에만 사용)
  4. **"지침 관리"** 탭에서 사업비 관리지침 등 PDF/HWPX 파일 업로드
  5. **"사업계획서 검토"** 탭에서 사업계획서 업로드 → "검토 시작"
- 지원 형식: **PDF, HWPX**. 구버전 **.hwp**는 브라우저가 직접 열 수 없어서, 한글에서 "다른 이름으로 저장 → PDF" (또는 HWPX)로 변환 후 올려야 합니다.
- 모든 처리(문서 파싱, 지침 매칭)는 브라우저 안에서만 일어나고, 학습된 지침/검토 이력은 그 브라우저(localStorage)에만 저장됩니다. 다른 사람과 공유되지 않고, 컴퓨터를 바꾸면 다시 학습시켜야 합니다.
- LLM 호출만 브라우저에서 Groq API로 직접 나갑니다 (서버 없음, 무료).

## 2. 파이썬 서버 버전 — `app.py` (구버전 .hwp까지 완전 지원하고 싶을 때)

.hwp 파일을 PDF로 변환하는 게 번거로운 경우를 위한 버전입니다. 각자 PC에 파이썬을 설치하고 로컬 서버를 띄워 사용합니다.

1. 파이썬 3.10 이상 설치 ([python.org](https://www.python.org/downloads/) 에서 "Add to PATH" 체크하고 설치)
2. 이 저장소를 원하는 폴더에 클론
   ```
   git clone https://github.com/jason7897/lips-agreement-review.git
   cd lips-agreement-review
   ```
3. 가상환경 생성 및 패키지 설치
   ```
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   ```
4. `.env.example`을 복사해 `.env`를 만들고 Groq API 키 입력
   ```
   copy .env.example .env
   ```
5. 서버 실행
   ```
   uvicorn app:app --reload
   ```
6. 브라우저에서 http://127.0.0.1:8000 접속

다음에 실행할 때는 `venv\Scripts\activate` 후 `uvicorn app:app --reload`만 실행하면 됩니다.

## 구조

- `lips-review.html` — 설치 없는 버전 (PDF.js/JSZip을 CDN에서 불러와 브라우저에서 직접 파싱, Groq API 직접 호출, localStorage 저장)
- `app.py` / `extract.py` / `sections.py` / `db.py` / `llm.py` / `static/index.html` — 파이썬 서버 버전 (구버전 .hwp까지 지원, SQLite 저장)

두 버전 모두 지침 조항 분할, 관련도 검색(bigram 유사도, 임베딩 없이 무료), Groq LLM 판정 로직은 동일합니다.

## 주의사항

- 두 버전 모두 지침 문서는 각자 업로드해서 학습시켜야 합니다 (데이터가 팀원 간 공유되지 않음, 완전 로컬).
- 스캔본(이미지) 문서는 텍스트 추출이 안 될 수 있습니다 — 텍스트 레이어가 있는 문서만 지원합니다.
- 서버 버전의 `review.db`(SQLite)와 `.env`는 git에 커밋되지 않습니다(`.gitignore` 처리).
