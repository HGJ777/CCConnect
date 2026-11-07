// Mixby service worker: notifications only (no offline caching, so the website always loads fresh from the server).
// Push messages come from the server's Web Push (deliverPush in server/src/index.js); tapping one opens the right chat.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let message = {}
  try { message = event.data ? event.data.json() : {} } catch { message = { title: 'Mixby', body: event.data ? event.data.text() : '' } }
  const data = message.data || {}
  // Always show something: iPhones stop delivering to sites that receive pushes without showing them.
  event.waitUntil(self.registration.showNotification(message.title || 'Mixby', {
    body: message.body || '',
    tag: message.tag || 'mixby', // a newer notification from the same chat replaces the older one
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const target = new URL('/', self.location.origin)
  target.searchParams.set('push', JSON.stringify({ kind: data.kind, projectRoomId: data.projectRoomId, courseGroupId: data.courseGroupId, postId: data.postId }))
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
    // Mixby already open: bring it forward and let it open the chat; otherwise start it at that chat.
    if (open) {
      open.postMessage({ type: 'mixby-push-tap', data })
      return open.focus()
    }
    return self.clients.openWindow(target.href)
  })())
})
