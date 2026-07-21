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

const GUIDELINES_HEADERS = ['id', 'source_file', 'label', 'content', 'uploaded_at'];
const SESSIONS_HEADERS = ['id', 'filename', 'created_at', 'items_json'];

// 'Sessions'/'Guidelines' 탭을 실수로 수동 편집/삭제해도 데이터를 복구할 수 있도록,
// 저장할 때마다 별도의 보관용(Archive) 탭에도 같은 행을 추가로 남긴다. 이 탭은 화면 어디서도
// 읽지 않으므로 평소에 열어볼 일이 없어 실수로 지워질 위험이 낮다.
const SESSIONS_ARCHIVE_SHEET = 'Sessions_Archive';
const GUIDELINES_ARCHIVE_SHEET = 'Guidelines_Archive';

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
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
    return json_({ error: '알 수 없는 action: ' + action });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function listGuidelines_() {
  const sh = getSheet_('Guidelines', GUIDELINES_HEADERS);
  const rows = sh.getDataRange().getValues().slice(1).filter(r => r[0]);
  return rows.map(r => ({
    id: r[0], source_file: r[1], label: r[2], content: r[3], uploaded_at: r[4],
  }));
}

function addGuidelines_(body) {
  const sh = getSheet_('Guidelines', GUIDELINES_HEADERS);
  const uploadedAt = new Date().toISOString();
  const chunks = body.chunks || [];
  const rows = chunks.map(c => [Utilities.getUuid(), body.source_file, c[0], c[1], uploadedAt]);
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
  const sessions = rows.map(r => ({
    id: r[0], filename: r[1], created_at: r[2], items: JSON.parse(r[3] || '[]'),
  }));
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
  const row = [id, body.filename, createdAt, JSON.stringify(body.items || [])];
  sh.appendRow(row);
  appendArchiveRows_(SESSIONS_ARCHIVE_SHEET, SESSIONS_HEADERS, [row]);
  return { id: id, created_at: createdAt };
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
  ['Guidelines', 'Sessions', GUIDELINES_ARCHIVE_SHEET, SESSIONS_ARCHIVE_SHEET].forEach(name => {
    const headers = (name === 'Guidelines' || name === GUIDELINES_ARCHIVE_SHEET) ? GUIDELINES_HEADERS : SESSIONS_HEADERS;
    const sh = getSheet_(name, headers);
    const already = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (already.length) return;
    sh.protect()
      .setDescription('실수로 인한 삭제 방지 - lips-review.html 웹앱을 통해서만 편집하세요')
      .setWarningOnly(true);
  });
  return { ok: true };
}
