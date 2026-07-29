// LIPS2 에이전트 서비스워커 - "네트워크 우선, 오프라인일 때만 캐시" 전략.
// 이 파일이 자주 업데이트되므로 캐시 우선 전략을 쓰면 오래된 버전이 계속 보일 위험이 있어
// 일부러 network-first로 구현했다. file:// 로 열면 브라우저가 서비스워커 등록 자체를
// 지원하지 않아 이 파일은 로드되지 않는다 (http/https로 호스팅해야 동작).
const CACHE_NAME = 'lips2-agent-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
