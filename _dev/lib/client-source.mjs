// 客户端源码只在 scripts/lib/client-source.mjs 里维护一份读取逻辑，
// 测试侧保留这个入口，避免 `_dev/` 里各套件各写一遍目录遍历。
export { readAuthoredClient } from '../../scripts/lib/client-source.mjs'
