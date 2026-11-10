import { libraryMethods } from './libraries.js'
import { tmMethods } from './tm.js'
import { glossaryMethods } from './glossary.js'
import { persistenceMethods } from './persistence.js'
import { importExportMethods } from './import-export.js'
import { preTranslateMethods } from './pre-translate.js'
import { qaMethods } from './qa.js'
import { libraryViewMethods } from './library-view.js'
import { propagateMethods } from './propagate.js'
import { alignMethods } from './aligner.js'
import { termMethods } from './terms.js'
import { briefMethods } from './brief.js'
import { analysisMethods } from './analysis.js'
import { tmMaintenanceMethods } from './tm-maintenance.js'
import { replaceMethods } from './replace.js'
import { noteMethods } from './notes.js'
import { lockMethods } from './lock.js'
import { segmentEditMethods } from './segment-edit.js'
import { subtitleMethods } from './subtitles.js'
import { reviewMethods } from './review.js'

/**
 * The one place that decides which module owns which part of the store API.
 *
 * CatStore is assembled from these plain objects instead of inheriting from a
 * chain of base classes, because the store is a single piece of state and the
 * domains genuinely share it. The cost of that choice is that a method's owner
 * used to be invisible: `Object.assign` silently replaced anything that was
 * declared twice. `applyMixins` therefore rejects duplicates while the store is
 * being assembled, and this table is the only list that has to be edited when a
 * domain module is added, renamed or removed.
 */
export const STORE_MIXINS = [
  {
    name: 'libraries',
    file: 'libraries.js',
    exportName: 'libraryMethods',
    methods: libraryMethods,
  },
  { name: 'tm', file: 'tm.js', exportName: 'tmMethods', methods: tmMethods },
  {
    name: 'glossary',
    file: 'glossary.js',
    exportName: 'glossaryMethods',
    methods: glossaryMethods,
  },
  {
    name: 'persistence',
    file: 'persistence.js',
    exportName: 'persistenceMethods',
    methods: persistenceMethods,
  },
  {
    name: 'importExport',
    file: 'import-export.js',
    exportName: 'importExportMethods',
    methods: importExportMethods,
  },
  {
    name: 'preTranslate',
    file: 'pre-translate.js',
    exportName: 'preTranslateMethods',
    methods: preTranslateMethods,
  },
  { name: 'qa', file: 'qa.js', exportName: 'qaMethods', methods: qaMethods },
  {
    name: 'libraryView',
    file: 'library-view.js',
    exportName: 'libraryViewMethods',
    methods: libraryViewMethods,
  },
  {
    name: 'propagate',
    file: 'propagate.js',
    exportName: 'propagateMethods',
    methods: propagateMethods,
  },
  { name: 'align', file: 'aligner.js', exportName: 'alignMethods', methods: alignMethods },
  { name: 'terms', file: 'terms.js', exportName: 'termMethods', methods: termMethods },
  { name: 'brief', file: 'brief.js', exportName: 'briefMethods', methods: briefMethods },
  {
    name: 'analysis',
    file: 'analysis.js',
    exportName: 'analysisMethods',
    methods: analysisMethods,
  },
  {
    name: 'tmMaintenance',
    file: 'tm-maintenance.js',
    exportName: 'tmMaintenanceMethods',
    methods: tmMaintenanceMethods,
  },
  { name: 'replace', file: 'replace.js', exportName: 'replaceMethods', methods: replaceMethods },
  { name: 'notes', file: 'notes.js', exportName: 'noteMethods', methods: noteMethods },
  { name: 'lock', file: 'lock.js', exportName: 'lockMethods', methods: lockMethods },
  {
    name: 'segmentEdit',
    file: 'segment-edit.js',
    exportName: 'segmentEditMethods',
    methods: segmentEditMethods,
  },
  {
    name: 'subtitles',
    file: 'subtitles.js',
    exportName: 'subtitleMethods',
    methods: subtitleMethods,
  },
  { name: 'review', file: 'review.js', exportName: 'reviewMethods', methods: reviewMethods },
]

/**
 * Copies every mixin onto a prototype after proving that no name is declared
 * twice — neither by two mixins nor by the class body itself. Returns a map of
 * method name to the mixin that owns it, which is what `check:store` prints.
 */
export function applyMixins(Store, mixins = STORE_MIXINS) {
  const owner = new Map()
  const clash = (key, previous, next) => {
    throw new Error(`store method "${key}" is defined twice: ${previous} and ${next}`)
  }
  for (const mixin of mixins) {
    for (const key of Object.keys(mixin.methods)) {
      if (owner.has(key)) clash(key, owner.get(key), mixin.name)
      if (Object.prototype.hasOwnProperty.call(Store.prototype, key)) {
        clash(key, 'the CatStore class body', mixin.name)
      }
      owner.set(key, mixin.name)
    }
  }
  for (const mixin of mixins) Object.assign(Store.prototype, mixin.methods)
  return owner
}
