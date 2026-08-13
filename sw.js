/* =========================================================
   아임수학학원 서비스워커 — 웹 푸시 알림 담당
   ⚙️ 아래 firebaseConfig 6개 값을 파이어베이스 콘솔에서 복사한 값으로 바꿔주세요
      (Project settings → General → 웹 앱 등록하면 나오는 값이에요)
========================================================= */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyA_eKm80oZKPrZM2Nc7KH28U9xFAfGyydY",
  authDomain: "im-math.firebaseapp.com",
  projectId: "im-math",
  storageBucket: "im-math.firebasestorage.app",
  messagingSenderId: "553499784115",
  appId: "1:553499784115:web:eb72ca41f0c206c0b551c6"
});

const messaging = firebase.messaging();
const NOTIF_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIj4KPGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+CjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI0YyNzAxQyIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0M4NTgxMiIvPgo8L2xpbmVhckdyYWRpZW50PjwvZGVmcz4KPHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIHJ4PSI0MiIgZmlsbD0idXJsKCNnKSIvPgo8dGV4dCB4PSIxMDAiIHk9IjEyOCIgZm9udC1mYW1pbHk9IidOb3RvIFNhbnMgS1InLCAnTWFsZ3VuIEdvdGhpYycsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOTYiIGZvbnQtd2VpZ2h0PSI4MDAiIGZpbGw9IiNGRkYzRTgiIHRleHQtYW5jaG9yPSJtaWRkbGUiPuyVhOyehDwvdGV4dD4KPC9zdmc+';

// 앱/사이트가 꺼져 있거나 다른 탭을 보고 있을 때도 이 핸들러가 알림을 띄워줘요
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || '아임수학학원';
  const body = (payload.notification && payload.notification.body) || (payload.data && payload.data.body) || '';
  const url = (payload.data && payload.data.url) || './';

  self.registration.showNotification(title, {
    body: body,
    icon: NOTIF_ICON,
    badge: NOTIF_ICON,
    data: { url: url }
  });
});

// 알림을 탭하면 해당 페이지로 이동 (이미 열려 있으면 그 탭으로 포커스, 없으면 새로 열기)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetPath.split('?')[0].split('/').pop()) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetPath);
    })
  );
});
