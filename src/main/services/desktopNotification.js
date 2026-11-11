// The operating-system notification, dressed like the application: the round
// mark, the event's name as the heading, the one line of detail the bell already
// shows, and — in small type under it — the kind of record.
//
// Windows draws the popup itself. Its frame, fonts and colours belong to the
// system, so "matching the interface" here means the parts the app does control:
// which mark is shown, what each line says, and in what order. A title/body pair
// alone produces a toast with no mark and no attribution line, so on Windows the
// whole thing is described as toast XML instead.

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

// A ToastGeneric image source is a URI, never a native path, and the space in
// "Program Files" is percent-encoded so the toast shell resolves it on the nose.
export function fileUrl(nativePath) {
  if (!nativePath) return ''
  const target = String(nativePath).replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(target)) return encodeURI(`file:///${target}`)
  if (target.startsWith('//')) return encodeURI(`file:${target}`)
  return encodeURI(`file://${target.startsWith('/') ? '' : '/'}${target}`)
}

// The attribution line echoes the small uppercase label the notification rows
// give each kind, after the application name — so a toast reads the way the bell
// reads: name, detail, kind.
export function buildToastXml({ heading, body, kindLabel, appName = 'eNote', iconSrc, duration = 'short' }) {
  const attribution = [appName, kindLabel ? String(kindLabel).toUpperCase() : '']
    .filter(Boolean)
    .join(' · ')

  const lines = [`<text>${escapeXml(heading)}</text>`]
  if (body) lines.push(`<text>${escapeXml(body)}</text>`)
  // The mark is the same asset as the window and taskbar icon, cropped to a
  // circle by Windows so a toast and the app never look like two products.
  if (iconSrc) lines.push(`<image placement="appLogoOverride" hint-crop="circle" src="${escapeXml(iconSrc)}"/>`)
  lines.push(`<text placement="attribution">${escapeXml(attribution)}</text>`)

  return [
    `<toast duration="${duration === 'long' ? 'long' : 'short'}" activationType="foreground">`,
    '<visual>',
    '<binding template="ToastGeneric">',
    ...lines,
    '</binding>',
    '</visual>',
    // Silent on purpose: the app's own chime is the sound of a new notification
    // and Settings governs it. A system sound would double every event and could
    // not be muted from inside the app.
    '<audio silent="true"/>',
    '</toast>'
  ].join('')
}
