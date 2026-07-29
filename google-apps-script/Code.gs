/**
 * LIPS 협약 사업계획서 검토 도구 - 공유 백엔드 (Google Apps Script)
 *
 * 이 스크립트를 구글시트에 연결해 웹앱으로 배포하면, lips-review.html이
 * localStorage 대신 이 시트를 통해 지침/검토 이력을 읽고 씁니다.
 * → 어떤 PC/브라우저에서 열어도 같은 데이터를 보게 됩니다.
 *
 * 배포 방법:
 * 1. 새 구글시트를 만든다 (예: "LIPS 협약 도구 데이터").
 * 2. 확장 프로그램 > Apps Script 메뉴로 들어간다.
 * 3. 기본 생성된 코드를 지우고 이 파일 내용 전체를 붙여넣는다.
 * 4. 저장 후, 우측 상단 "배포 > 새 배포" 클릭.
 * 5. 유형 선택에서 "웹 앱" 선택.
 * 6. "실행 계정"은 나(작성자), "액세스 권한"은 "모든 사용자"로 설정.
 * 7. 배포를 누르고 나오는 웹 앱 URL(.../exec 로 끝남)을 복사한다.
 * 8. lips-review.html 안의 SCRIPT_URL 상수에 그 주소를 붙여넣는다.
 * 9. (선택) GitHub에 커밋/푸시하면 다른 PC에서 파일을 받아도 자동으로 같은 시트를 바라본다.
 *
 * 이후 시트/스크립트를 수정하려면 "배포 > 배포 관리 > 수정"으로 같은 배포에 새 버전을 올려야
 * 웹 앱 URL이 바뀌지 않는다.
 */

// doc_type/review_type/program_tag/hit_count/status는 기존 배포에 나중에 추가된 컬럼이라 맨 끝에
// 붙인다 (getSheet_가 기존 탭 헤더 뒤에만 이어붙이므로, 앞쪽에 넣으면 이미 저장된 행과 컬럼이 어긋난다).
const GUIDELINES_HEADERS = ['id', 'source_file', 'label', 'content', 'uploaded_at', 'doc_type', 'program_tag'];
const SESSIONS_HEADERS = ['id', 'filename', 'created_at', 'items_json', 'reviewer', 'review_type', 'status'];
const QNA_HEADERS = ['id', 'question', 'answer', 'used_docs_json', 'asked_by', 'created_at', 'hit_count'];
const GUIDELINE_DOC_TYPES = ['지침', '공고문', '사례'];
const SESSION_STATUSES = ['대기', '승인', '반려'];

// 신뢰도 "낮음" Q&A 답변 발생 시 알림 메일을 받을 주소 - 필요하면 바꿔서 재배포하면 된다.
const ADMIN_NOTIFY_EMAIL = 'jason@k-aia.or.kr';

// 'Sessions'/'Guidelines'/'QnA' 탭을 실수로 수동 편집/삭제해도 데이터를 복구할 수 있도록,
// 저장할 때마다 별도의 보관용(Archive) 탭에도 같은 행을 추가로 남긴다. 이 탭은 화면 어디서도
// 읽지 않으므로 평소에 열어볼 일이 없어 실수로 지워질 위험이 낮다.
const SESSIONS_ARCHIVE_SHEET = 'Sessions_Archive';
const GUIDELINES_ARCHIVE_SHEET = 'Guidelines_Archive';
const QNA_ARCHIVE_SHEET = 'QnA_Archive';

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    return sh;
  }
  // 이미 있는 탭에 헤더 컬럼이 나중에 추가된 경우(예: reviewer), 기존 데이터는 그대로 두고
  // 헤더 행에 빠진 컬럼명만 채워 넣는다.
  const existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (existing.length < headers.length) {
    sh.getRange(1, existing.length + 1, 1, headers.length - existing.length).setValues([headers.slice(existing.length)]);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  try {
    if (action === 'list_guidelines') return json_(listGuidelines_());
    if (action === 'list_sessions') return json_(listSessions_());
    if (action === 'list_qna') return json_(listQna_());
    if (action === 'list_guideline_archive') return json_(listGuidelineArchive_(e.parameter.source_file || ''));
    if (action === 'setup_protection') return json_(protectAgainstManualEdits_());
    return json_({ error: '알 수 없는 action: ' + action });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: '잘못된 요청 본문' });
  }
  const action = body.action || '';
  try {
    if (action === 'add_guidelines') return json_(addGuidelines_(body));
    if (action === 'clear_guidelines') return json_(clearGuidelines_());
    if (action === 'save_session') return json_(saveSession_(body));
    if (action === 'delete_session') return json_(deleteSession_(body));
    if (action === 'delete_guideline_source') return json_(deleteGuidelineSource_(body));
    if (action === 'save_qna') return json_(saveQna_(body));
    if (action === 'delete_qna') return json_(deleteQna_(body));
    if (action === 'bump_qna_hit') return json_(bumpQnaHit_(body));
    if (action === 'update_session_status') return json_(updateSessionStatus_(body));
    return json_({ error: '알 수 없는 action: ' + action });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function listGuidelines_() {
  const sh = getSheet_('Guidelines', GUIDELINES_HEADERS);
  const rows = sh.getDataRange().getValues().slice(1).filter(r => r[0]);
  return rows.map(r => ({
    // doc_type이 없는 옛 행(이 기능 추가 이전에 저장됨)은 전부 '지침' 업로드였으므로 그렇게 간주한다.
    id: r[0], source_file: r[1], label: r[2], content: r[3], uploaded_at: r[4], doc_type: r[5] || '지침', program_tag: r[6] || '',
  }));
}

function addGuidelines_(body) {
  const sh = getSheet_('Guidelines', GUIDELINES_HEADERS);
  const uploadedAt = new Date().toISOString();
  const chunks = body.chunks || [];
  const docType = GUIDELINE_DOC_TYPES.indexOf(body.doc_type) >= 0 ? body.doc_type : '지침';
  const programTag = (body.program_tag || '').trim();
  const rows = chunks.map(c => [Utilities.getUuid(), body.source_file, c[0], c[1], uploadedAt, docType, programTag]);
  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, GUIDELINES_HEADERS.length).setValues(rows);
    appendArchiveRows_(GUIDELINES_ARCHIVE_SHEET, GUIDELINES_HEADERS, rows);
  }
  return { ok: true, added: rows.length };
}

function clearGuidelines_() {
  const sh = getSheet_('Guidelines', GUIDELINES_HEADERS);
  sh.clearContents();
  sh.appendRow(GUIDELINES_HEADERS);
  return { ok: true };
}

function listSessions_() {
  const sh = getSheet_('Sessions', SESSIONS_HEADERS);
  const rows = sh.getDataRange().getValues().slice(1).filter(r => r[0]);
  const sessions = rows.map(r => {
    // items_json은 예전엔 items 배열을 그대로 담았고, 지금은 {items, usedGuidelines}를 담는다 - 둘 다 지원.
    let payload;
    try { payload = JSON.parse(r[3] || '{}'); } catch (e) { payload = {}; }
    const items = Array.isArray(payload) ? payload : (payload.items || []);
    const usedGuidelines = Array.isArray(payload) ? [] : (payload.usedGuidelines || []);
    // review_type/status가 없는 옛 행(이 기능 추가 이전에 저장됨)은 전부 사업비 집행 검토·대기 상태였다.
    return { id: r[0], filename: r[1], created_at: r[2], items, usedGuidelines, reviewer: r[4] || '', review_type: r[5] || 'budget', status: r[6] || '대기' };
  });
  sessions.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sessions;
}

/* 잘못 저장된 항목(테스트/오류 데이터) 정리용. UI에는 연결하지 않은 유지보수용 액션 —
   Archive 탭에는 남겨두고 'Sessions' 원본 탭에서만 지운다. */
function deleteSession_(body) {
  const sh = getSheet_('Sessions', SESSIONS_HEADERS);
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === body.id) { sh.deleteRow(i + 1); return { ok: true, deleted: 1 }; }
  }
  return { ok: true, deleted: 0 };
}

function saveSession_(body) {
  const sh = getSheet_('Sessions', SESSIONS_HEADERS);
  const id = Utilities.getUuid();
  const createdAt = new Date().toISOString();
  const itemsJson = JSON.stringify({ items: body.items || [], usedGuidelines: body.usedGuidelines || [] });
  const row = [id, body.filename, createdAt, itemsJson, body.reviewer || '', body.review_type === 'eligibility' ? 'eligibility' : 'budget', '대기'];
  sh.appendRow(row);
  appendArchiveRows_(SESSIONS_ARCHIVE_SHEET, SESSIONS_HEADERS, [row]);
  return { id: id, created_at: createdAt };
}

/* 담당자 승인 워크플로 - 검토 결과 자체(items_json)는 건드리지 않고 상태값만 바꾼다. */
function updateSessionStatus_(body) {
  const sh = getSheet_('Sessions', SESSIONS_HEADERS);
  const status = SESSION_STATUSES.indexOf(body.status) >= 0 ? body.status : '대기';
  const statusCol = SESSIONS_HEADERS.indexOf('status') + 1;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.id) {
      sh.getRange(i + 1, statusCol).setValue(status);
      return { ok: true, status: status };
    }
  }
  return { ok: false };
}

/* 지침·공고문 개정 이력(감사로그) 조회 - Guidelines_Archive는 절대 삭제하지 않으므로, 이 문서명으로
   지금까지 업로드된 모든 버전(현재 삭제된 것 포함)이 그대로 남아있다. */
function listGuidelineArchive_(sourceFile) {
  if (!sourceFile) return [];
  const sh = getSheet_(GUIDELINES_ARCHIVE_SHEET, GUIDELINES_HEADERS);
  const rows = sh.getDataRange().getValues().slice(1).filter(r => r[0] && r[1] === sourceFile);
  return rows
    .map(r => ({ id: r[0], source_file: r[1], label: r[2], content: r[3], uploaded_at: r[4], doc_type: r[5] || '지침', program_tag: r[6] || '' }))
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
}

/* 지침 문서 하나(source_file 기준)만 삭제 - 전체 삭제(clear_guidelines) 없이 특정 문서만 교체/제거할 때 사용 */
function deleteGuidelineSource_(body) {
  const sh = getSheet_('Guidelines', GUIDELINES_HEADERS);
  const data = sh.getDataRange().getValues();
  let deleted = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][1] === body.source_file) { sh.deleteRow(i + 1); deleted++; }
  }
  return { ok: true, deleted: deleted };
}

function listQna_() {
  const sh = getSheet_('QnA', QNA_HEADERS);
  const rows = sh.getDataRange().getValues().slice(1).filter(r => r[0]);
  const list = rows.map(r => {
    let usedDocs;
    try { usedDocs = JSON.parse(r[3] || '[]'); } catch (e) { usedDocs = []; }
    // hit_count가 없는 옛 행(이 기능 추가 이전에 저장됨)은 최소 1회로 간주한다.
    return { id: r[0], question: r[1], answer: r[2], usedDocs: usedDocs, asked_by: r[4] || '', created_at: r[5], hit_count: Number(r[6]) || 1 };
  });
  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return list;
}

function saveQna_(body) {
  const sh = getSheet_('QnA', QNA_HEADERS);
  const id = Utilities.getUuid();
  const createdAt = new Date().toISOString();
  const usedDocsJson = JSON.stringify(body.usedDocs || []);
  const row = [id, body.question || '', body.answer || '', usedDocsJson, body.asked_by || '', createdAt, 1];
  sh.appendRow(row);
  appendArchiveRows_(QNA_ARCHIVE_SHEET, QNA_HEADERS, [row]);
  if (body.confidence === '낮음') notifyLowConfidenceQna_(body.question, body.answer, body.asked_by);
  return { id: id, created_at: createdAt };
}

/* 신뢰도 낮은 1차 답변은 담당자가 놓치지 않도록 메일로 알린다. 메일 발송 권한이 아직 승인되지
   않았거나(재배포 직후 등) 일시적으로 실패해도 QnA 저장 자체는 이미 끝났으므로 조용히 무시한다. */
function notifyLowConfidenceQna_(question, answer, askedBy) {
  try {
    MailApp.sendEmail({
      to: ADMIN_NOTIFY_EMAIL,
      subject: '[LIPS 협약 도구] 신뢰도 낮은 Q&A 답변 발생 - 확인 필요',
      body: `질문자: ${askedBy || '(미입력)'}\n\n질문:\n${question}\n\nAI 1차 답변(신뢰도 낮음):\n${answer}\n\n` +
        'lips-review.html의 Q&A 탭에서 원문과 근거 조항을 확인해주세요.',
    });
  } catch (e) {
    console.error('낮은 신뢰도 Q&A 알림 메일 발송 실패:', e);
  }
}

/* 새 질문이 기존 질문과 비슷하다고 판단돼 그 답변을 그대로 재사용한 경우 호출 - "자주 묻는 질문"
   집계용 hit_count만 1 증가시킨다 (원본 텍스트는 수정하지 않으므로 Archive에 별도 기록 불필요). */
function bumpQnaHit_(body) {
  const sh = getSheet_('QnA', QNA_HEADERS);
  const data = sh.getDataRange().getValues();
  const hitCol = QNA_HEADERS.indexOf('hit_count') + 1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === body.id) {
      const current = Number(data[i][hitCol - 1]) || 1;
      sh.getRange(i + 1, hitCol).setValue(current + 1);
      return { ok: true, hit_count: current + 1 };
    }
  }
  return { ok: false };
}

/* 잘못 저장된 질문(테스트/오류 데이터) 정리용. UI에는 연결하지 않은 유지보수용 액션 —
   Sessions의 delete_session과 동일하게 Archive 탭에는 남겨두고 원본 'QnA' 탭에서만 지운다. */
function deleteQna_(body) {
  const sh = getSheet_('QnA', QNA_HEADERS);
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === body.id) { sh.deleteRow(i + 1); return { ok: true, deleted: 1 }; }
  }
  return { ok: true, deleted: 0 };
}

/* ===================== 보관용(Archive) 백업 =====================
   'Sessions'/'Guidelines' 탭이 (수동 편집 등으로) 실수로 지워지는 사고에 대비해,
   저장할 때마다 별도 탭에도 같은 행을 추가로 남긴다. 이 함수는 오직 appendRow만 하고
   절대 지우지 않으므로, 원본 탭 데이터가 사라져도 이 탭에서 그대로 복구할 수 있다. */
function appendArchiveRows_(sheetName, headers, rows) {
  const sh = getSheet_(sheetName, headers);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

/* 사고 발생 시 수동 복구용: Apps Script 편집기에서 이 함수를 직접 실행하면 Archive 탭에는
   있지만 원본 'Sessions' 탭에는 없는 행(id 기준)을 원본 탭에 다시 채워 넣는다. */
function restoreSessionsFromArchive_() {
  const archive = getSheet_(SESSIONS_ARCHIVE_SHEET, SESSIONS_HEADERS);
  const sh = getSheet_('Sessions', SESSIONS_HEADERS);
  const archiveRows = archive.getDataRange().getValues().slice(1).filter(r => r[0]);
  const existingIds = new Set(sh.getDataRange().getValues().slice(1).map(r => r[0]));
  const missing = archiveRows.filter(r => !existingIds.has(r[0]));
  if (missing.length) {
    sh.getRange(sh.getLastRow() + 1, 1, missing.length, SESSIONS_HEADERS.length).setValues(missing);
  }
  return missing.length;
}

/* ===================== 실수 방지: 시트 보호 =====================
   'Sessions'/'Guidelines' 탭에 경고만 뜨는 보호를 걸어, 시트를 직접 열어 수동으로
   셀을 지우거나 편집하려 할 때 확인 창이 한 번 더 뜨도록 한다(소유자도 예외 없이 적용).
   여러 번 실행해도 중복 보호가 걸리지 않도록 기존 보호가 있으면 건너뛴다. */
function protectAgainstManualEdits_() {
  ['Guidelines', 'Sessions', 'QnA', GUIDELINES_ARCHIVE_SHEET, SESSIONS_ARCHIVE_SHEET, QNA_ARCHIVE_SHEET].forEach(name => {
    let headers = SESSIONS_HEADERS;
    if (name === 'Guidelines' || name === GUIDELINES_ARCHIVE_SHEET) headers = GUIDELINES_HEADERS;
    else if (name === 'QnA' || name === QNA_ARCHIVE_SHEET) headers = QNA_HEADERS;
    const sh = getSheet_(name, headers);
    const already = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (already.length) return;
    sh.protect()
      .setDescription('실수로 인한 삭제 방지 - lips-review.html 웹앱을 통해서만 편집하세요')
      .setWarningOnly(true);
  });
  return { ok: true };
}
