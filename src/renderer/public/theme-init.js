// Pre-paint bootstrap for the app's two device-local appearance choices:
//   - .dark / .oled on <html> (theme, so the first paint is already in the right
//     mode). Pure black is a dark theme: it sets both classes, and index.css
//     overrides the surfaces for .oled.
//   - data-motion on <html> (performance vs power save motion, so nothing
//     animates in a mode the user is about to leave)
// CSP forbids inline scripts, so this ships as a plain public asset loaded
// before ./main.jsx. Dark is the default; an explicit stored choice wins.
(function () {
  try {
    // The application used to be called iStudy and preferences were stored
    // under that prefix. Carry them over once so a rename does not reset the
    // theme, the motion mode, the language or a saved pane width.
    var legacyKeys = []
    for (var i = 0; i < localStorage.length; i++) {
      var legacyKey = localStorage.key(i)
      if (legacyKey && legacyKey.indexOf('istudy-') === 0) legacyKeys.push(legacyKey)
    }
    for (var j = 0; j < legacyKeys.length; j++) {
      var renamedKey = 'enote-' + legacyKeys[j].slice('istudy-'.length)
      if (localStorage.getItem(renamedKey) === null) {
        localStorage.setItem(renamedKey, localStorage.getItem(legacyKeys[j]))
      }
    }

    var pref = localStorage.getItem('enote-theme')
    var prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    var oled = pref === 'oled'
    var dark = oled || pref === 'dark' || (pref === 'system' ? !!prefersDark : pref !== 'light')
    document.documentElement.classList.toggle('dark', !!dark)
    document.documentElement.classList.toggle('oled', !!oled)

    // Accent palette, before the first paint: red, gold, blue and pink are CSS
    // overrides keyed on this attribute, so an unstyled frame would flash emerald.
    var accent = localStorage.getItem('enote-accent')
    document.documentElement.dataset.accent =
      accent === 'red' || accent === 'gold' || accent === 'blue' || accent === 'pink'
        ? accent
        : 'emerald'

    var motion = localStorage.getItem('enote-motion')
    var prefersStill =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.documentElement.dataset.motion =
      motion === 'powersave' || (motion !== 'performance' && !!prefersStill)
        ? 'powersave'
        : 'performance'

    // Native surfaces (select popups, date pickers) are drawn by Chromium
    // outside the page, so the window's appearance is set before React mounts.
    try {
      if (window.api && window.api.setNativeTheme) {
        window.api.setNativeTheme(pref === 'system' ? 'system' : dark ? 'dark' : 'light')
      }
    } catch (nativeThemeError) {
      /* an older preload simply keeps the OS appearance */
    }
  } catch (e) {
    document.documentElement.classList.add('dark')
    document.documentElement.dataset.motion = 'performance'
  }
})()
