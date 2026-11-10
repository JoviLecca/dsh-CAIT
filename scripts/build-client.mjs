import { writeFileSync } from 'node:fs'
import { buildClientSource, clientBundlePath } from './lib/client-source.mjs'

const source = await buildClientSource()
writeFileSync(clientBundlePath, source, 'utf8')
console.log(`built client.js (${(source.length / 1024).toFixed(0)} KB)`)
