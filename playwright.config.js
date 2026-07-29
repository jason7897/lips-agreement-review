// LIPS2 에이전트 스모크 테스트 설정.
// file://로 직접 여는 실제 사용 방식과 동일하게 로컬 서버 없이 파일을 바로 연다.
// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
