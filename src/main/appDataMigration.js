import { app } from 'electron'
import fs from 'fs'
import { join } from 'path'

// The application used to be called iStudy. Electron derives the user-data
// folder from the app name, so a rename would silently point every existing
// installation at a fresh, empty folder: uploaded lesson files, the
// direct-message key and any other local state would look lost. Move the old
// folder under the new name once, before anything reads from it.
//
// This module is imported first in main/index.js because documentService
// resolves its documents folder when that module is evaluated, which happens
// while the imports above it are still being resolved.
const LEGACY_NAMES = ['istudy', 'iStudy']

export function migrateAppDataFolder() {
  let appData = ''
  try {
    appData = app.getPath('appData')
  } catch {
    return
  }

  const target = join(appData, app.getName())
  // A fresh install has nothing to carry over, and an installation that has
  // already run once must never be overwritten by the old folder.
  if (fs.existsSync(target)) return

  for (const legacyName of LEGACY_NAMES) {
    const legacy = join(appData, legacyName)
    if (!fs.existsSync(legacy)) continue
    try {
      fs.renameSync(legacy, target)
      console.log(`Moved the previous app-data folder "${legacyName}" to "${app.getName()}".`)
    } catch (error) {
      console.warn(`Could not move the app-data folder "${legacyName}":`, error.message)
    }
    return
  }
}

migrateAppDataFolder()
