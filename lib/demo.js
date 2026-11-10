import { normalizeText } from './similarity.js'

/**
 * demo: part of the CatStore API, registered in lib/store-mixins.js.
 */
export const demoMethods = {
  loadDemo() {
    const text = [
      'Computer-aided translation tools help translators work faster and more consistently. A translation memory stores previously translated sentences, so repetitive passages can be reused with a single click.',
      'Terminology databases keep product names and technical terms consistent across documents. Every confirmed segment can be written back to the translation memory, building a reusable knowledge base for the next project.',
      'A good CAT workbench brings the source text, the target editor, translation memory matches, glossary hits, and machine translation suggestions into one focused workspace.',
    ].join('\n\n')

    const created = this.createDocument({
      name: 'CAIT 演示 · 产品简介',
      text,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    })

    const terms = [
      ['computer-aided translation', '计算机辅助翻译', 'CAT 的全称'],
      ['translation memory', '翻译记忆库', '存储已翻译句段'],
      ['terminology database', '术语库', '维护术语一致性'],
      ['segment', '句段', 'CAT 的基本翻译单位'],
      ['workspace', '工作台', '译者的操作界面'],
    ]
    for (const [source, target, note] of terms) {
      if (!this.glossary.some((entry) => normalizeText(entry.source) === normalizeText(source))) {
        this.addGlossary({ source, target, note, sourceLang: 'en' })
      }
    }

    const memories = [
      [
        'A translation memory stores previously translated sentences.',
        '翻译记忆库存储以前翻译过的句子。',
      ],
      [
        'Computer-aided translation tools help translators work faster and more consistently.',
        '计算机辅助翻译工具帮助译者更快、更一致地工作。',
      ],
      [
        'Terminology databases keep product names and technical terms consistent.',
        '术语库让产品名称和技术术语保持一致。',
      ],
    ]
    for (const [source, target] of memories) {
      this.upsertTM(source, target, 'en', 'zh-CN')
    }
    this.touch()
    this.persist()

    return created
  },
}
