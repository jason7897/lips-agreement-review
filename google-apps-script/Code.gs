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
const MAX_SESSIONS = 50;

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
  return sessions.slice(0, MAX_SESSIONS);
}

function saveSession_(body) {
  const sh = getSheet_('Sessions', SESSIONS_HEADERS);
  const id = Utilities.getUuid();
  const createdAt = new Date().toISOString();
  sh.appendRow([id, body.filename, createdAt, JSON.stringify(body.items || [])]);
  return { id: id, created_at: createdAt };
}
