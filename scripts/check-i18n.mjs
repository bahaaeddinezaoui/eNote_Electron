import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from '@babel/parser'

// Fails the build when a UI string has no Arabic or French entry.
//
// The interface uses English text as the dictionary key. This check collects
// the keys the renderer actually asks for:
//   - the first argument of every tr(...) and t(...) call (including the
//     branches of a conditional);
//   - string values of label/title/summary/description/text/hint properties,
//     which are rendered through tr(...) by the shared components;
//   - every string inside the pageGuides GUIDES table, because the guide
//     dialog passes those strings through t(...) without a literal call.
//
// It deliberately does not try to classify arbitrary JSX text: the project's
// convention is that user-visible text goes through the dictionaries.

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const RENDERER = path.join(ROOT, 'src', 'renderer')
const I18N_DIR = path.join(RENDERER, 'i18n')
const LANGUAGES = ['ar', 'fr']
const UI_FIELDS = new Set(['label', 'title', 'summary', 'description', 'text', 'hint'])
const ROLE_CODES = new Set([
  'ADMIN',
  'DEVELOPER',
  'DIRECTOR',
  'SECRETARY',
  'SCHEDULER',
  'TEACHER',
  'STUDENT'
])
// Autonyms stay in their own language in the language picker.
const IGNORED = new Set(['English', 'العربية', 'Français'])
const MAX_REPORTED = 200

const normalize = (value) => String(value).replace(/\s+/g, ' ').trim()

const isUiString = (value) => {
  const text = String(value)
  if (!text.trim() || text.length > 4000) return false
  if (!/[A-Za-z\u00c0-\u024f\u0600-\u06ff]/.test(text)) return false
  if (text.startsWith('/') || text.startsWith('./') || text.startsWith('../')) return false
  if (text.startsWith('http')) return false
  if (text.startsWith('--') || /^(var|color-mix|calc)\(/.test(text)) return false
  if (
    /^(text|bg|border|ring|fill|stroke|from|via|to|shadow|outline|font|leading|tracking|space|gap|p[trblxy]?|m[trblxy]?|w|h|min|max|grid|flex|items|justify|self|place|content|overflow|object|z|opacity|transition|duration|ease|animate|cursor|select|pointer|absolute|relative|fixed|sticky|hidden|block|inline|sr-only)-/.test(
      text
    )
  ) {
    return false
  }
  if (ROLE_CODES.has(text) || IGNORED.has(text)) return false
  if (/^[A-Z0-9_]+$/.test(text)) return false
  if (text.includes('${')) return false
  return true
}

const SKIP_KEYS = new Set([
  'loc',
  'start',
  'end',
  'extra',
  'errors',
  'comments',
  'tokens',
  'leadingComments',
  'trailingComments',
  'innerComments'
])

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent)
    return
  }
  if (typeof node.type === 'string') visit(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue
    if (value && typeof value === 'object') walk(value, visit, node)
  }
}

function literalStrings(node, out = []) {
  if (!node) return out
  if (node.type === 'StringLiteral') {
    out.push(node)
    return out
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    out.push({ value: node.quasis[0]?.value?.cooked ?? node.quasis[0]?.value?.raw, loc: node.loc })
    return out
  }
  if (node.type === 'ConditionalExpression') {
    literalStrings(node.consequent, out)
    literalStrings(node.alternate, out)
  }
  return out
}

function collectRendererFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'i18n') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectRendererFiles(full, out)
    } else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.endsWith('.test.js')) {
      out.push(full)
    }
  }
  return out
}

async function loadDictionaries() {
  const dictionaries = { ar: new Map(), fr: new Map() }
  const files = fs
    .readdirSync(I18N_DIR)
    .filter((name) => /^(ar|fr)(-\d+)?\.js$/.test(name))

  for (const name of files) {
    const language = name.startsWith('ar') ? 'ar' : 'fr'
    const module = await import(pathToFileURL(path.join(I18N_DIR, name)).href)
    for (const exported of Object.values(module)) {
      if (!exported || typeof exported !== 'object' || Array.isArray(exported)) continue
      for (const [key, value] of Object.entries(exported)) {
        dictionaries[language].set(key, value)
      }
    }
  }

  return dictionaries
}

function parseFile(file) {
  const code = fs.readFileSync(file, 'utf8')
  return parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
    attachComment: false
  })
}

const usages = new Map()

function record(value, file, loc) {
  const key = normalize(value)
  if (!isUiString(key)) return
  if (!usages.has(key)) usages.set(key, [])
  usages.get(key).push({
    file: path.relative(ROOT, file).replaceAll('\\', '/'),
    line: loc?.start?.line ?? 1
  })
}

for (const file of collectRendererFiles(RENDERER)) {
  let ast
  try {
    ast = parseFile(file)
  } catch (error) {
    console.error(`i18n check: could not parse ${path.relative(ROOT, file)}: ${error.message}`)
    process.exit(1)
  }

  walk(ast, (node) => {
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      (node.callee.name === 'tr' || node.callee.name === 't')
    ) {
      for (const literal of literalStrings(node.arguments?.[0])) {
        if (typeof literal.value === 'string') record(literal.value, file, literal.loc ?? node.loc)
      }
    }

    if (node.type === 'ObjectProperty' && !node.computed) {
      const name =
        node.key?.type === 'Identifier'
          ? node.key.name
          : node.key?.type === 'StringLiteral'
            ? node.key.value
            : null
      if (UI_FIELDS.has(name)) {
        for (const literal of literalStrings(node.value)) {
          if (typeof literal.value === 'string') record(literal.value, file, literal.loc ?? node.loc)
        }
      }
    }
  })

  // Page guides are plain strings in an array, so they are not object property
  // values. Collect every string inside GUIDES; route keys are filtered out by
  // isUiString.
  if (path.basename(file) === 'pageGuides.js') {
    walk(ast, (node) => {
      if (
        node.type === 'VariableDeclarator' &&
        node.id?.type === 'Identifier' &&
        node.id.name === 'GUIDES'
      ) {
        walk(node.init, (child) => {
          if (child.type === 'StringLiteral' && typeof child.value === 'string') {
            record(child.value, file, child.loc)
          }
        })
      }
    })
  }
}

const dictionaries = await loadDictionaries()
const missing = []

for (const [key, sources] of usages) {
  const absent = LANGUAGES.filter((language) => {
    const value = dictionaries[language].get(key)
    return typeof value !== 'string' || value.trim() === ''
  })
  if (absent.length) {
    missing.push({ key, absent, source: sources[0] })
  }
}

if (missing.length) {
  missing.sort((a, b) => a.key.localeCompare(b.key))
  console.error(
    `i18n check failed: ${missing.length} UI string${missing.length === 1 ? '' : 's'} missing an Arabic or French translation.`
  )
  for (const entry of missing.slice(0, MAX_REPORTED)) {
    const languages = entry.absent.map((language) => (language === 'ar' ? 'Arabic' : 'French')).join(', ')
    console.error(`  ${entry.source.file}:${entry.source.line}  ${JSON.stringify(entry.key)}  (missing ${languages})`)
  }
  if (missing.length > MAX_REPORTED) {
    console.error(`  … and ${missing.length - MAX_REPORTED} more.`)
  }
  console.error('Add the missing entries to src/renderer/i18n/ar*.js and fr*.js.')
  process.exit(1)
}

console.log(
  `i18n check passed: ${usages.size} UI strings covered by ${dictionaries.ar.size} Arabic and ${dictionaries.fr.size} French keys.`
)
