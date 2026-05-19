import * as monaco from 'monaco-editor'

let initialized = false

export function initBuiltInDiagnostics() {
  if (initialized) return
  initialized = true

  // Language services are available at runtime but typed as deprecated in 0.55.1
  const langs = monaco.languages as any
  const ts = langs.typescript
  const css = langs.css
  const json = langs.json

  // TypeScript/JavaScript
  ts?.javascriptDefaults?.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  })
  ts?.typescriptDefaults?.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  })

  ts?.javascriptDefaults?.setCompilerOptions({
    target: ts.ScriptTarget?.ESNext ?? 99,
    allowJs: true,
    checkJs: true,
    allowNonTsExtensions: true,
  })

  // CSS
  css?.cssDefaults?.setDiagnosticsOptions({
    validate: true,
    lint: {
      compatibleVendorPrefixes: 'warning',
      vendorPrefix: 'warning',
      duplicateProperties: 'warning',
      emptyRules: 'warning',
      importStatement: 'warning',
      boxModel: 'warning',
      universalSelector: 'warning',
      zeroUnits: 'warning',
      fontFaceProperties: 'warning',
      hexColorLength: 'warning',
      argumentsInColorFunction: 'warning',
      unknownProperties: 'warning',
      ieHack: 'warning',
      unknownVendorSpecificProperties: 'warning',
      propertyIgnoredDueToDisplay: 'warning',
      important: 'warning',
      float: 'warning',
      idSelector: 'warning',
    },
  })

  // JSON
  json?.jsonDefaults?.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    trailingCommas: 'warning',
  })
}
