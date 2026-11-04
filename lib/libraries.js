import { CatError } from './errors.js'
import { DEFAULT_GLOSSARY_ID, DEFAULT_GLOSSARY_NAME, DEFAULT_TM_ID, DEFAULT_TM_NAME, cleanLibraryName, makeId, now, restoredDate } from './store-utils.js'

export const libraryMethods = {
  resetLibraryState() {
    const stamp = now()
    this.tmLibraries = [
      {
        tmId: DEFAULT_TM_ID,
        name: DEFAULT_TM_NAME,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ]
    this.glossaryLibraries = [
      {
        glossaryId: DEFAULT_GLOSSARY_ID,
        name: DEFAULT_GLOSSARY_NAME,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ]
    this.mounts = {
      tmIds: [DEFAULT_TM_ID],
      glossaryIds: [DEFAULT_GLOSSARY_ID],
      defaultTmId: DEFAULT_TM_ID,
      defaultGlossaryId: DEFAULT_GLOSSARY_ID,
    }
  }
,
  requireTmLibrary(tmId) {
    const id = String(tmId ?? '').trim() || this.mounts.defaultTmId
    if (!this.tmLibraries.some((library) => library.tmId === id)) {
      throw new CatError('TM_NOT_FOUND', `翻译记忆库不存在: ${id}`, 404)
    }
    return id
  }
,
  requireMountedTmLibrary(tmId) {
    const id = this.requireTmLibrary(tmId)
    if (!this.mounts.tmIds.includes(id)) {
      throw new CatError(
        'TM_NOT_MOUNTED',
        `翻译记忆库未挂载: ${id}，请先在 CAIT 的库面板挂载它。`,
        409,
      )
    }
    return id
  }
,
  requireGlossaryLibrary(glossaryId) {
    const id = String(glossaryId ?? '').trim() || this.mounts.defaultGlossaryId
    if (!this.glossaryLibraries.some((library) => library.glossaryId === id)) {
      throw new CatError('GLOSSARY_NOT_FOUND', `术语库不存在: ${id}`, 404)
    }
    return id
  }
,
  requireMountedGlossaryLibrary(glossaryId) {
    const id = this.requireGlossaryLibrary(glossaryId)
    if (!this.mounts.glossaryIds.includes(id)) {
      throw new CatError(
        'GLOSSARY_NOT_MOUNTED',
        `术语库未挂载: ${id}，请先在 CAIT 的库面板挂载它。`,
        409,
      )
    }
    return id
  }
,
  mountsView() {
    return {
      tmIds: [...this.mounts.tmIds],
      glossaryIds: [...this.mounts.glossaryIds],
      defaultTmId: this.mounts.defaultTmId,
      defaultGlossaryId: this.mounts.defaultGlossaryId,
    }
  }
,
  librariesView() {
    const mountedTm = new Set(this.mounts.tmIds)
    const mountedGlossary = new Set(this.mounts.glossaryIds)
    return {
      tm: this.tmLibraries.map((library) => ({
        ...library,
        mounted: mountedTm.has(library.tmId),
        entryCount: this.tm.filter((entry) => entry.tmId === library.tmId).length,
      })),
      glossary: this.glossaryLibraries.map((library) => ({
        ...library,
        mounted: mountedGlossary.has(library.glossaryId),
        entryCount: this.glossary.filter((entry) => entry.glossaryId === library.glossaryId).length,
      })),
    }
  }
,
  createLibrary({ kind, name } = {}) {
    const libraryKind = String(kind ?? '').trim()
    const stamp = now()
    if (libraryKind === 'tm') {
      const library = {
        tmId: makeId('tm'),
        name: cleanLibraryName(name, 'Untitled TM'),
        createdAt: stamp,
        updatedAt: stamp,
      }
      this.tmLibraries.push(library)
      this.mounts.tmIds = [...new Set([...this.mounts.tmIds, library.tmId])]
      this.touch()
      this.persist()
      return {
        library: this.librariesView().tm.find((item) => item.tmId === library.tmId),
        mounts: this.mountsView(),
      }
    }
    if (libraryKind === 'glossary') {
      const library = {
        glossaryId: makeId('gl'),
        name: cleanLibraryName(name, 'Untitled glossary'),
        createdAt: stamp,
        updatedAt: stamp,
      }
      this.glossaryLibraries.push(library)
      this.mounts.glossaryIds = [
        ...new Set([...this.mounts.glossaryIds, library.glossaryId]),
      ]
      this.touch()
      this.persist()
      return {
        library: this.librariesView().glossary.find(
          (item) => item.glossaryId === library.glossaryId,
        ),
        mounts: this.mountsView(),
      }
    }
    throw new CatError('INVALID_LIBRARY_KIND', '库类型必须是 tm 或 glossary')
  }
,
  setMounts({ tmIds, glossaryIds, defaultTmId, defaultGlossaryId } = {}) {
    if (tmIds !== undefined && !Array.isArray(tmIds)) {
      throw new CatError('INVALID_TM_MOUNT', 'tmIds 必须是数组。')
    }
    if (glossaryIds !== undefined && !Array.isArray(glossaryIds)) {
      throw new CatError('INVALID_GLOSSARY_MOUNT', 'glossaryIds 必须是数组。')
    }
    const nextTmIds =
      tmIds === undefined
        ? [...this.mounts.tmIds]
        : [...new Set(tmIds.filter((id) => typeof id === 'string' && id))]
    const nextGlossaryIds =
      glossaryIds === undefined
        ? [...this.mounts.glossaryIds]
        : [...new Set(glossaryIds.filter((id) => typeof id === 'string' && id))]

    if (!nextTmIds.length) throw new CatError('EMPTY_TM_MOUNT', '至少挂载一个翻译记忆库。')
    if (!nextGlossaryIds.length) throw new CatError('EMPTY_GLOSSARY_MOUNT', '至少挂载一个术语库。')
    for (const id of nextTmIds) this.requireTmLibrary(id)
    for (const id of nextGlossaryIds) this.requireGlossaryLibrary(id)

    let nextDefaultTmId = defaultTmId === undefined ? this.mounts.defaultTmId : defaultTmId
    let nextDefaultGlossaryId =
      defaultGlossaryId === undefined ? this.mounts.defaultGlossaryId : defaultGlossaryId
    if (!nextTmIds.includes(nextDefaultTmId)) {
      if (defaultTmId === undefined) nextDefaultTmId = nextTmIds[0]
      else throw new CatError('DEFAULT_TM_NOT_MOUNTED', '默认翻译记忆库必须处于挂载状态。')
    }
    if (!nextGlossaryIds.includes(nextDefaultGlossaryId)) {
      if (defaultGlossaryId === undefined) nextDefaultGlossaryId = nextGlossaryIds[0]
      else throw new CatError('DEFAULT_GLOSSARY_NOT_MOUNTED', '默认术语库必须处于挂载状态。')
    }

    this.mounts = {
      tmIds: nextTmIds,
      glossaryIds: nextGlossaryIds,
      defaultTmId: nextDefaultTmId,
      defaultGlossaryId: nextDefaultGlossaryId,
    }
    this.touch()
    this.persist()
    return { mounts: this.mountsView(), libraries: this.librariesView() }
  }

}
