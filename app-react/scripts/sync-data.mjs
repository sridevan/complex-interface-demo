import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')            // repo root
const proc = resolve(root, 'data', 'processed')
const mvsSrc = resolve(root, 'app', 'public', 'mvs')
const pubData = resolve(here, '..', 'public', 'data')
const pubMvs = resolve(here, '..', 'public', 'mvs')
mkdirSync(pubData, { recursive: true }); mkdirSync(pubMvs, { recursive: true })
if (existsSync(proc)) cpSync(proc, pubData, { recursive: true })
if (existsSync(mvsSrc)) cpSync(mvsSrc, pubMvs, { recursive: true })
console.log('synced processed data + mvs scenes into public/')
