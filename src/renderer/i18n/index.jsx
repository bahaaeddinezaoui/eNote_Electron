import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ar } from './ar'
import { fr } from './fr'
import { ar1 } from './ar-1'
import { ar2 } from './ar-2'
import { ar3 } from './ar-3'
import { ar4 } from './ar-4'
import { ar5 } from './ar-5'
import { ar6 } from './ar-6'
import { ar7 } from './ar-7'
import { ar8 } from './ar-8'
import { ar9 } from './ar-9'
import { ar10 } from './ar-10'
import { ar11 } from './ar-11'
import { ar12 } from './ar-12'
import { ar13 } from './ar-13'
import { ar14 } from './ar-14'
import { ar15 } from './ar-15'
import { ar16 } from './ar-16'
import { ar17 } from './ar-17'
import { ar18 } from './ar-18'
import { ar19 } from './ar-19'
import { ar20 } from './ar-20'
import { ar21 } from './ar-21'
import { ar22 } from './ar-22'
import { ar23 } from './ar-23'
import { ar24 } from './ar-24'
import { ar25 } from './ar-25'
import { ar26 } from './ar-26'
import { ar27 } from './ar-27'
import { ar28 } from './ar-28'
import { ar29 } from './ar-29'
import { ar30 } from './ar-30'
import { ar31 } from './ar-31'
import { ar32 } from './ar-32'
import { ar33 } from './ar-33'
import { ar34 } from './ar-34'
import { ar35 } from './ar-35'
import { ar36 } from './ar-36'
import { ar37 } from './ar-37'
import { ar38 } from './ar-38'
import { ar39 } from './ar-39'
import { ar40 } from './ar-40'
import { ar41 } from './ar-41'
import { ar42 } from './ar-42'
import { ar43 } from './ar-43'
import { ar44 } from './ar-44'
import { ar45 } from './ar-45'
import { ar46 } from './ar-46'
import { ar47 } from './ar-47'
import { ar48 } from './ar-48'
import { ar49 } from './ar-49'
import { ar50 } from './ar-50'
import { ar51 } from './ar-51'
import { ar52 } from './ar-52'
import { fr1 } from './fr-1'
import { fr2 } from './fr-2'
import { fr3 } from './fr-3'
import { fr4 } from './fr-4'
import { fr5 } from './fr-5'
import { fr6 } from './fr-6'
import { fr7 } from './fr-7'
import { fr8 } from './fr-8'
import { fr9 } from './fr-9'
import { fr10 } from './fr-10'
import { fr11 } from './fr-11'
import { fr12 } from './fr-12'
import { fr13 } from './fr-13'
import { fr14 } from './fr-14'
import { fr15 } from './fr-15'
import { fr16 } from './fr-16'
import { fr17 } from './fr-17'
import { fr18 } from './fr-18'
import { fr19 } from './fr-19'
import { fr20 } from './fr-20'
import { fr21 } from './fr-21'
import { fr22 } from './fr-22'
import { fr23 } from './fr-23'
import { fr24 } from './fr-24'
import { fr25 } from './fr-25'
import { fr26 } from './fr-26'
import { fr27 } from './fr-27'
import { fr28 } from './fr-28'
import { fr29 } from './fr-29'
import { fr30 } from './fr-30'
import { fr31 } from './fr-31'
import { fr32 } from './fr-32'
import { fr33 } from './fr-33'
import { fr34 } from './fr-34'
import { fr35 } from './fr-35'
import { fr36 } from './fr-36'
import { fr37 } from './fr-37'
import { fr38 } from './fr-38'
import { fr39 } from './fr-39'
import { fr40 } from './fr-40'
import { fr41 } from './fr-41'
import { fr42 } from './fr-42'
import { fr43 } from './fr-43'
import { fr44 } from './fr-44'
import { fr45 } from './fr-45'
import { fr46 } from './fr-46'
import { fr47 } from './fr-47'
import { fr48 } from './fr-48'
import { fr49 } from './fr-49'
import { fr50 } from './fr-50'
import { fr51 } from './fr-51'
import { fr52 } from './fr-52'
import { fr53 } from './fr-53'
import { fr54 } from './fr-54'
import { fr55 } from './fr-55'

// Interface language is a device-local choice stored in localStorage, exactly
// like the light/dark theme. It drives three things:
//   - the interface strings (this dictionary layer),
//   - the page direction (`dir="rtl"` for Arabic),
//   - the language of database labels, which the main process applies when it
//     returns rows (`window.api.setLanguage`, see src/main/localization.js).

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN', dir: 'ltr' },
  { code: 'ar', label: 'العربية', short: 'ع', dir: 'rtl' },
  { code: 'fr', label: 'Français', short: 'FR', dir: 'ltr' }
]

const DICTIONARIES = {
  ar: { ...ar, ...ar1, ...ar2, ...ar3, ...ar4, ...ar5, ...ar6, ...ar7, ...ar8, ...ar9, ...ar10, ...ar11, ...ar12, ...ar13, ...ar14, ...ar15, ...ar16, ...ar17, ...ar18, ...ar19, ...ar20, ...ar21, ...ar22, ...ar23, ...ar24, ...ar25, ...ar26, ...ar27, ...ar28, ...ar29, ...ar30, ...ar31, ...ar32, ...ar33, ...ar34, ...ar35, ...ar36, ...ar37, ...ar38, ...ar39, ...ar40, ...ar41, ...ar42, ...ar43, ...ar44, ...ar45, ...ar46, ...ar47, ...ar48, ...ar49, ...ar50, ...ar51, ...ar52 },
  fr: { ...fr, ...fr1, ...fr2, ...fr3, ...fr4, ...fr5, ...fr6, ...fr7, ...fr8, ...fr9, ...fr10, ...fr11, ...fr12, ...fr13, ...fr14, ...fr15, ...fr16, ...fr17, ...fr18, ...fr19, ...fr20, ...fr21, ...fr22, ...fr23, ...fr24, ...fr25, ...fr26, ...fr27, ...fr28, ...fr29, ...fr30, ...fr31, ...fr32, ...fr33, ...fr34, ...fr35, ...fr36, ...fr37, ...fr38, ...fr39, ...fr40, ...fr41, ...fr42, ...fr43, ...fr44, ...fr45, ...fr46, ...fr47, ...fr48, ...fr49, ...fr50, ...fr51, ...fr52, ...fr53, ...fr54, ...fr55 }
}
const STORAGE_KEY = 'enote-language'

export function getStoredLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return LANGUAGES.some(l => l.code === stored) ? stored : 'en'
  } catch {
    return 'en'
  }
}

function storeLanguage(language) {
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Storage unavailable — the choice still applies for this session.
  }
}

// Module-level mirror so helpers that are not components (row label picking)
// always read the current language.
let activeLanguage = typeof window !== 'undefined' ? getStoredLanguage() : 'en'

export const getActiveLanguage = () => activeLanguage

export const languageDir = (language = activeLanguage) => (language === 'ar' ? 'rtl' : 'ltr')

export function applyLanguage(language) {
  const next = LANGUAGES.some(l => l.code === language) ? language : 'en'
  activeLanguage = next
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next
    document.documentElement.dir = languageDir(next)
  }
  return next
}

// Sends the choice to the main process so subsequent queries localize their
// reference labels. Safe to call before the window's api is ready.
export function syncLanguageToMain(language) {
  applyLanguage(language)
  try {
    window.api?.setLanguage?.(language)?.catch?.(() => {})
  } catch {
    // The database label language is best-effort; the interface still switches.
  }
}

export function initLanguage() {
  syncLanguageToMain(getStoredLanguage())
}

export function setLanguage(language) {
  if (!LANGUAGES.some(l => l.code === language)) return activeLanguage
  const next = language
  storeLanguage(next)
  syncLanguageToMain(next)
  return next
}

// English text is the key; a missing translation falls back to it.
export function translate(language, key, vars) {
  const dictionary = DICTIONARIES[language] || {}
  let text = dictionary[key] ?? key
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (match, name) =>
      vars[name] === undefined || vars[name] === null ? match : String(vars[name])
    )
  }
  return text
}

// Translate without a hook, for JSX text and markup attributes. JSX text keeps
// the whitespace that separates it from neighbouring elements, so the leading
// and trailing whitespace of the key is preserved around the translation and
// the lookup itself uses the collapsed form.
export function tr(key, vars) {
  const raw = String(key ?? '')
  if (!raw.trim()) return raw
  const lead = raw.match(/^\s*/)[0]
  const trail = raw.match(/\s*$/)[0]
  const normalized = raw.replace(/\s+/g, ' ').trim()
  return lead + translate(activeLanguage, normalized, vars) + trail
}

// Picks a reference label out of a database row in the active language, with
// the other language in brackets:
//   localizedLabel(row, 'WILAYA_NAME') -> "الجزائر (Alger)" in Arabic,
//                                        "Alger (الجزائر)" in English.
// A row that only carries the alias was already formatted by the main process,
// so it is handed back untouched.
const LABEL_ORDER = {
  ar: ['AR', 'EN', 'FR', 'LA'],
  fr: ['FR', 'LA', 'EN', 'AR'],
  en: ['EN', 'LA', 'FR', 'AR']
}

const LABEL_COUNTERPART = {
  ar: ['EN', 'LA', 'FR'],
  en: ['AR'],
  fr: ['AR']
}

export function localizedLabel(row, key, language = activeLanguage) {
  if (!row) return ''
  const order = LABEL_ORDER[language] || LABEL_ORDER.en
  let primary = null
  for (const suffix of order) {
    const value = row[`${key}_${suffix}`]
    if (typeof value === 'string' && value.trim() !== '') {
      primary = value
      break
    }
  }
  if (primary === null) {
    const base = row[key]
    return base === undefined || base === null ? '' : base
  }

  const shown = primary.trim()
  for (const suffix of LABEL_COUNTERPART[language] || []) {
    const other = row[`${key}_${suffix}`]
    if (typeof other === 'string' && other.trim() !== '' && other.trim() !== shown) {
      return `${primary} (${other})`
    }
  }
  return primary
}

const I18nContext = createContext({
  lang: 'en',
  dir: 'ltr',
  t: key => key,
  setLang: () => {}
})

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(getStoredLanguage)

  useEffect(() => {
    storeLanguage(lang)
    syncLanguageToMain(lang)
  }, [lang])

  const setLang = useCallback((next) => {
    if (!LANGUAGES.some(l => l.code === next)) return
    // Tell the main process first so the queries triggered by the re-render
    // below already return labels in the new language.
    storeLanguage(next)
    syncLanguageToMain(next)
    setLangState(next)
  }, [])

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang])

  const value = useMemo(() => ({
    lang,
    dir: languageDir(lang),
    t,
    setLang,
    languages: LANGUAGES
  }), [lang, t, setLang])

  // Re-mount the tree on a language change: it re-runs every screen's data
  // effects (so database labels reload in the new language) and guarantees
  // every string is re-rendered, while the signed-in session lives in
  // localStorage and survives.
  return (
    <I18nContext.Provider value={value}>
      <React.Fragment key={lang}>{children}</React.Fragment>
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
