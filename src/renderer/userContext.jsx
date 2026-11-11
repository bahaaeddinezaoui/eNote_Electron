import { createContext, useContext } from 'react'

// The signed-in account, shared with the page chrome.
//
// Pages receive the user as a prop, but the header and the page guide sit
// outside those props: the guide needs the roles to pick the steps, and the
// header is drawn by Layout for every page. One provider in the layout keeps
// that read from turning into a prop drilled through forty screens.
const UserContext = createContext(null)

export const UserProvider = UserContext.Provider

export function useCurrentUser() {
  return useContext(UserContext)
}
