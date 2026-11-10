import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildClientSource, CLIENT_PARTS, projectRoot } from './lib/client-source.mjs'

writeFileSync(join(projectRoot, 'client.js'), buildClientSource())
console.log(`built client.js from ${CLIENT_PARTS.length} fragments`)
