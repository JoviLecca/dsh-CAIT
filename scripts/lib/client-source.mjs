import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 客户端产物的唯一拼装入口。
 *
 * `client.js` 不是手写文件，而是把 `client/` 下的六个片段按顺序拼进同一个
 * 函数作用域后生成的分发产物。构建脚本和一致性校验都必须走这里，避免
 * 「谁拼的」和「谁查的」两份实现漂移。
 */
export const CLIENT_PARTS = [
  'helpers.js',
  'styles.js',
  'rpc.js',
  'components.js',
  'locales.js',
  'entry.js',
]

export const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const HEADER = `window.__ModuleLoader__.load({
  id: 'dsh-cait',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef } = React
`

export function buildClientSource(root = projectRoot) {
  const body = CLIENT_PARTS.map((name) =>
    readFileSync(join(root, 'client', name), 'utf8').replace(/\s+$/, ''),
  ).join('\n\n')
  return `${HEADER}\n${body}\n`
}
