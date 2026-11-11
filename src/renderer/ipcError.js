// Electron wraps a rejected ipcRenderer.invoke in a transport sentence:
//   Error invoking remote method 'persons:update': Error: A person with this ID already exists.
// The service's own message is the useful part. Forms show this instead, so a
// validation rule is never presented as an IPC failure.
export function ipcErrorMessage(error, fallback = '') {
  const raw = (typeof error === 'string' ? error : error?.message || '').trim()
  const unwrapped = raw.match(/Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]*)$/)
  const message = (unwrapped ? unwrapped[1] : raw).replace(/^(?:Error:\s*)+/, '').trim()
  return message || fallback
}
