// LIPS2 에이전트 스모크 테스트.
//
// 실제 사용 방식(file://로 더블클릭해서 열기)과 동일하게 로컬 서버 없이 파일을 직접 연다.
// 지침 목록(list_guidelines) 등 "읽기" 호출은 실제 라이브 Apps Script 백엔드를 그대로 사용해
// 진짜 연동이 살아있는지 확인한다 - 다만 저장(write)이 필요한 흐름은 항상 해당 POST 액션만
// 가짜 응답으로 가로채, 테스트가 실제 운영 시트에 데이터를 남기지 않게 한다.
// Groq(LLM) 호출도 항상 가짜 응답으로 가로챈다 - 실제 API 키나 비용 없이 렌더링 파이프라인만 검증한다.
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file://' + path.resolve(__dirname, '..', 'lips-review.html').replace(/\\/g, '/');

function mockGroq(page, responseObj) {
  return page.route('https://api.groq.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseObj) } }] }),
  }));
}

// save_session/save_qna/bump_qna_hit/save_item_feedback/log_error처럼 실제 시트에 쓰는 액션만
// 골라 가짜로 응답한다. list_* 같은 읽기 액션은 그대로 실제 백엔드로 통과시킨다.
function mockWriteActions(page) {
  const writeActions = ['save_session', 'save_qna', 'bump_qna_hit', 'save_item_feedback', 'log_error', 'update_session_status', 'add_guidelines'];
  return page.route('**/macros/s/**', async route => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      if (writeActions.some(a => body.includes(`"${a}"`))) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ id: 'test-fake-id', created_at: new Date().toISOString(), ok: true }),
        });
      }
    }
    return route.continue();
  });
}

test('페이지 로드 + 6개 탭 전환 + 콘솔 에러 없음', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto(FILE_URL);
  await expect(page).toHaveTitle('LIPS2 에이전트');

  const tabs = ['review', 'qna', 'guidelines', 'drive-batch', 'history', 'stats'];
  for (const tab of tabs) {
    await page.click(`nav button[data-view="${tab}"]`);
    await expect(page.locator(`#view-${tab}`)).toHaveClass(/active/);
  }

  expect(pageErrors, `콘솔에 처리되지 않은 JS 오류 발생: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('지침 목록이 실제 라이브 백엔드에서 로드됨', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.click('nav button[data-view="guidelines"]');
  // 실제 구글시트에 저장된 지침이 있으므로(국가계약법 시행령 기본 제공 등) 최소 1행은 보여야 한다.
  await expect(page.locator('#guideline-list table tbody tr').first()).toBeVisible({ timeout: 20000 });
});

test('사업비 집행 검토: 가짜 LLM 응답으로 결과 표가 렌더링됨 (비목/사용가능여부 컬럼 포함)', async ({ page }) => {
  await mockGroq(page, {
    items: [{
      item_label: '테스트 항목(홍보물 인쇄비)',
      amount_summary: '1,000,000원',
      cost_category: '일반수용비',
      cost_category_match: '적정',
      usability: '사용가능',
      verdict: '적합',
      reason: '테스트용 사유',
      guideline_ref: '',
      suggestion: '',
    }],
  });
  await mockWriteActions(page);

  await page.goto(FILE_URL);
  await page.evaluate(() => localStorage.setItem('lips_groq_api_key', 'fake-key-for-test'));
  // 실제 PDF 파싱 대신 extractText를 오버라이드해 사업비 표 텍스트를 바로 반환 -
  // pdf.js/실제 PDF 없이도 검토 로직(reviewBusinessPlan)부터 렌더링까지 검증할 수 있다.
  await page.evaluate(() => {
    window.extractText = async () => '□ 사업비 구성 및 집행계획\n일반수용비(홍보물 인쇄비) 1,000,000원';
  });

  await page.setInputFiles('#plan-file', { name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('dummy-pdf-content-not-a-real-pdf') });
  await page.click('#btn-review');

  await expect(page.locator('#review-result .badge.적합').first()).toBeVisible({ timeout: 20000 });
  // 사업비 검토는 cost_category/usability를 채우므로 전용 컬럼이 표에 보여야 한다.
  await expect(page.locator('#review-result th', { hasText: '비목 분류' })).toBeVisible();
  await expect(page.locator('#review-result th', { hasText: '사용 가능 여부' })).toBeVisible();
});

test('지원요건 검토 모드: 비목 컬럼 없이 렌더링됨', async ({ page }) => {
  await mockGroq(page, {
    items: [{
      item_label: '업력 요건',
      amount_summary: '개업일 2022-01-01, 업력 약 4년',
      verdict: '확인필요',
      reason: '테스트용 사유',
      guideline_ref: '',
      suggestion: '',
    }],
  });
  // 지원요건 검토는 doc_type='공고문' 문서가 하나라도 있어야 진행되는데, 실제 운영 시트에는
  // 아직 공고문이 등록돼 있지 않다(지침만 있음) - 그래서 이 테스트만 list_guidelines 응답 자체를
  // 가짜 공고문 포함 데이터로 가로채, 실제 운영 데이터 상태와 무관하게 항상 재현 가능하게 한다.
  const fakeGuidelines = [
    { id: 'g1', source_file: '테스트 공고문', label: '지원대상', content: '업력 5년 이내 소상공인만 지원 가능', doc_type: '공고문', program_tag: '', uploaded_at: new Date().toISOString() },
  ];
  const writeActions = ['save_session', 'save_qna', 'bump_qna_hit', 'save_item_feedback', 'log_error', 'update_session_status', 'add_guidelines'];
  await page.route('**/macros/s/**', async route => {
    const req = route.request();
    if (req.method() === 'GET' && req.url().includes('action=list_guidelines')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeGuidelines) });
    }
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      if (writeActions.some(a => body.includes(`"${a}"`))) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ id: 'test-fake-id', created_at: new Date().toISOString(), ok: true }),
        });
      }
    }
    return route.continue();
  });

  await page.goto(FILE_URL);
  await page.evaluate(() => localStorage.setItem('lips_groq_api_key', 'fake-key-for-test'));
  await page.evaluate(() => {
    window.extractText = async () => '사업자등록번호: 123-45-67890\n개업일자: 2022.01.01\n사업계획서 본문...';
  });
  await page.click('#mode-eligibility');
  await page.setInputFiles('#plan-file', { name: 'test2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('dummy') });
  await page.click('#btn-review');

  await expect(page.locator('#review-result .badge.확인필요').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#review-result th', { hasText: '비목 분류' })).toHaveCount(0);
});

test('Q&A: 가짜 LLM 응답으로 답변 카드가 렌더링됨', async ({ page }) => {
  await mockGroq(page, { answer: '테스트 답변입니다.', confidence: '보통', note: '' });
  await mockWriteActions(page);

  await page.goto(FILE_URL);
  await page.evaluate(() => localStorage.setItem('lips_groq_api_key', 'fake-key-for-test'));
  await page.click('nav button[data-view="qna"]');
  await page.fill('#qna-question', '테스트 질문입니다');
  await page.click('#btn-ask-qna');

  await expect(page.locator('#qna-answer')).toContainText('테스트 답변입니다.', { timeout: 20000 });
});
