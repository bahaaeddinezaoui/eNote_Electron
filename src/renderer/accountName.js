// How the signed-in account is named in the window chrome (sidebar footer,
// title-bar account control and its menu).
//
// A person's own names are what identifies them; the username is the handle the
// account signs in with, so it is always shown next to the name, marked with
// "@". Accounts whose person row carries no name — or sessions restored from
// localStorage before the profile was re-read — fall back to the username alone
// rather than printing an empty line.
export function accountName(user) {
  const name = [user?.firstName, user?.lastName]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return name || user?.username || ''
}

// The two letters of the avatar tile: the initials of the person's names, and
// the first two characters of the username when there is no name to take them
// from.
export function accountInitials(user) {
  const initials = [user?.firstName, user?.lastName]
    .map((part) => String(part ?? '').trim().charAt(0))
    .join('')
  if (initials) return initials.toUpperCase()
  return (user?.username || 'U').slice(0, 2).toUpperCase()
}

// The handle as it is printed: "@username", or nothing when there is no username
// to print — never a bare "@".
export function accountHandle(user) {
  return user?.username ? `@${user.username}` : ''
}
