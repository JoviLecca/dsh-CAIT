import { readFileSync, writeFileSync } from 'node:fs'

const parts = ['helpers.js', 'styles.js', 'rpc.js', 'components.js', 'locales.js', 'entry.js']
const header = `window.__ModuleLoader__.load({
  id: 'dsh-cait',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef } = React
`
const body = parts.map((name) => readFileSync(`client/${name}`, 'utf8').replace(/\s+$/, '')).join('\n\n')
writeFileSync('client.js', `${header}\n${body}\n`)
console.log(`built client.js from ${parts.length} fragments`)
