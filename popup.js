const SETTINGS_STORAGE_KEY = 'subtitle_learning_prototype_settings_v1'
const SAVED_WORDS_STORAGE_KEY = 'subtitle_learning_saved_words_v1'
const CLICK_HISTORY_STORAGE_KEY = 'subtitle_learning_click_history_v1'
const BETA_ACCESS_STORAGE_KEY = 'subtitle_learning_beta_access_code_v1'
const DAY_MS = 24 * 60 * 60 * 1000

let settings = getDefaultSettings()

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs()
  settings = await loadSettings()
  renderSettings()
  setupBetaAccessCode()
  renderSaved()
  renderReview()
  renderHistory()
})

function getDefaultSettings() {
  return {
    extensionEnabled: true,
    autoEnableCaptions: true,
    hideNativeCaptions: true,
    overlayEnabled: true,
    fontSize: 24,
    textColor: '#ffffff',
    backgroundEnabled: true,
    backgroundColor: '#000000',
    bottomOffset: 72,
    nativeLanguage: 'tr',
    targetLanguage: 'en',
    subtitleLanguage: 'auto',
    explanationMode: 'deep',
    learnerLevel: 'B1',
    autoClosePopup: true
  }
}

function setupTabs() {
  const buttons = Array.from(document.querySelectorAll('.tab-button'))
  const panels = Array.from(document.querySelectorAll('.panel'))

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const tabName = button.dataset.tab

      for (const item of buttons) {
        item.classList.toggle('is-active', item === button)
      }

      for (const panel of panels) {
        panel.classList.toggle('is-active', panel.dataset.panel === tabName)
      }

      if (tabName === 'saved') renderSaved()
      if (tabName === 'review') renderReview()
      if (tabName === 'history') renderHistory()
    })
  }
}

async function loadSettings() {
  const storedSettings = await getStorageValue(SETTINGS_STORAGE_KEY, null)
  return normalizeSettings(storedSettings)
}

function normalizeSettings(storedSettings) {
  if (!storedSettings || typeof storedSettings !== 'object' || Array.isArray(storedSettings)) {
    return getDefaultSettings()
  }

  const defaults = getDefaultSettings()
  const legacyNativeLanguage = typeof storedSettings.nativeLanguage === 'string' ? storedSettings.nativeLanguage : ''
  const legacyTargetLanguage = typeof storedSettings.targetLanguage === 'string' ? storedSettings.targetLanguage : ''
  const legacyLearnerLanguage = typeof storedSettings.learnerLanguage === 'string' ? storedSettings.learnerLanguage : ''
  const legacyExplanationLanguage = typeof storedSettings.explanationLanguage === 'string' ? storedSettings.explanationLanguage : ''
  const legacySubtitleLanguage = typeof storedSettings.subtitleLanguage === 'string' ? storedSettings.subtitleLanguage : ''

  return {
    ...defaults,
    ...storedSettings,
    nativeLanguage: legacyNativeLanguage || legacyExplanationLanguage || legacyLearnerLanguage || defaults.nativeLanguage,
    targetLanguage: legacyTargetLanguage || getLegacyTargetLanguage(legacySubtitleLanguage) || defaults.targetLanguage,
    subtitleLanguage: legacySubtitleLanguage || defaults.subtitleLanguage,
    learnerLevel: normalizeLearnerLevel(storedSettings.learnerLevel, defaults.learnerLevel),
    extensionEnabled: typeof storedSettings.extensionEnabled === 'boolean' ? storedSettings.extensionEnabled : defaults.extensionEnabled,
    autoEnableCaptions: typeof storedSettings.autoEnableCaptions === 'boolean' ? storedSettings.autoEnableCaptions : defaults.autoEnableCaptions
  }
}

function getLegacyTargetLanguage(legacySubtitleLanguage) {
  if (!legacySubtitleLanguage || legacySubtitleLanguage === 'auto') return ''
  return legacySubtitleLanguage
}

function normalizeLearnerLevel(value, fallbackValue) {
  const level = String(value || '').trim().toUpperCase()
  return ['A2', 'B1', 'B2', 'C1'].includes(level) ? level : fallbackValue
}

function renderSettings() {
  const controls = Array.from(document.querySelectorAll('[data-setting]'))

  for (const control of controls) {
    const key = control.dataset.setting
    setControlValue(control, settings[key])
    updateValueLabel(key, settings[key])

    control.addEventListener('input', () => {
      updateSettingFromControl(control)
    })

    control.addEventListener('change', () => {
      updateSettingFromControl(control)
    })
  }
}

async function updateSettingFromControl(control) {
  const key = control.dataset.setting
  const value = readControlValue(control)

  settings = {
    ...settings,
    [key]: value
  }

  updateValueLabel(key, value)
  await setStorageValue(SETTINGS_STORAGE_KEY, settings)
}

function setControlValue(control, value) {
  if (control.type === 'checkbox') {
    control.checked = Boolean(value)
    return
  }

  control.value = String(value)
}

function readControlValue(control) {
  if (control.type === 'checkbox') {
    return control.checked
  }

  if (control.type === 'range') {
    return Number(control.value)
  }

  return control.value
}

function updateValueLabel(key, value) {
  const label = document.querySelector(`[data-value-for="${key}"]`)
  if (!label) return

  const suffix = ['fontSize', 'bottomOffset'].includes(key) ? 'px' : ''
  label.textContent = `${value}${suffix}`
}

async function setupBetaAccessCode() {
  const input = document.getElementById('beta-access-code')
  const saveButton = document.getElementById('save-beta-access-code')
  const clearButton = document.getElementById('clear-beta-access-code')
  const statusEl = document.getElementById('beta-access-status')
  const savedCode = await getStorageValue(BETA_ACCESS_STORAGE_KEY, '')

  updateBetaAccessStatus(statusEl, savedCode)

  saveButton?.addEventListener('click', async () => {
    const code = String(input?.value || '').trim()
    if (!code) {
      updateBetaAccessStatus(statusEl, savedCode)
      return
    }

    await setStorageValue(BETA_ACCESS_STORAGE_KEY, code)
    if (input) input.value = ''
    updateBetaAccessStatus(statusEl, code)
  })

  clearButton?.addEventListener('click', async () => {
    await setStorageValue(BETA_ACCESS_STORAGE_KEY, '')
    if (input) input.value = ''
    updateBetaAccessStatus(statusEl, '')
  })
}

function updateBetaAccessStatus(statusEl, code) {
  if (!statusEl) return

  const normalizedCode = String(code || '').trim()
  statusEl.textContent = normalizedCode
    ? `Saved (${maskAccessCode(normalizedCode)})`
    : 'Not set'
}

function maskAccessCode(code) {
  if (code.length <= 6) return '******'
  return `${code.slice(0, 4)}...${code.slice(-2)}`
}

async function renderSaved() {
  const list = document.getElementById('saved-list')
  const savedItems = await getStorageValue(SAVED_WORDS_STORAGE_KEY, [])
  list.textContent = ''

  if (!Array.isArray(savedItems) || !savedItems.length) {
    list.appendChild(createEmptyState('No saved words yet.'))
    return
  }

  for (const item of savedItems) {
    list.appendChild(createSavedCard(item))
  }
}

function createSavedCard(item) {
  const card = document.createElement('article')
  card.className = 'card'
  const normalizedItem = normalizeSavedItem(item)

  const title = document.createElement('div')
  title.className = 'card-title'
  title.textContent = normalizedItem.phrase || normalizedItem.word || '-'

  const meaning = document.createElement('div')
  meaning.className = 'card-text'
  meaning.textContent = normalizedItem.dictionaryMeaning || normalizedItem.contextualMeaning || normalizedItem.meaning || ''

  const meta = document.createElement('div')
  meta.className = 'card-meta'
  meta.textContent = [
    normalizedItem.videoTitle,
    normalizedItem.timestampLabel
  ].filter(Boolean).join(' - ') || formatDate(normalizedItem.savedAt || normalizedItem.timestamp)

  const detail = document.createElement('div')
  detail.className = 'card-detail'
  detail.hidden = true
  appendDetailRow(detail, 'Sentence', normalizedItem.sentence)
  appendDetailRow(detail, 'Translation', normalizedItem.sentenceTranslation)
  appendDetailRow(detail, 'Context', normalizedItem.contextualMeaning)
  appendDetailRow(detail, 'Register', normalizedItem.register)
  appendDetailRow(detail, 'Nuance', normalizedItem.nuanceNote)
  appendDetailRow(detail, 'Usage', normalizedItem.usageNote)
  appendDetailRow(detail, 'Example', normalizedItem.exampleUsage)
  appendDetailRow(detail, 'Collocations', normalizedItem.collocations)
  appendDetailRow(detail, 'Common mistake', normalizedItem.commonMistake)
  appendDetailRow(detail, 'Part of speech', normalizedItem.partOfSpeech)
  appendDetailRow(detail, 'Difficulty', normalizedItem.difficultyLevel)
  appendDetailRow(detail, 'Familiarity', normalizedItem.familiarityHint)
  appendDetailRow(detail, 'Learner level', normalizedItem.learnerLevelUsed)
  appendDetailRow(detail, 'Subtitle language', normalizedItem.subtitleLanguageDetected)

  const actions = document.createElement('div')
  actions.className = 'card-actions'

  const detailButton = document.createElement('button')
  detailButton.type = 'button'
  detailButton.className = 'ghost-button'
  detailButton.textContent = 'Detail'
  detailButton.addEventListener('click', () => {
    detail.hidden = !detail.hidden
    detailButton.textContent = detail.hidden ? 'Detail' : 'Hide'
  })

  const openButton = document.createElement('a')
  openButton.className = 'ghost-button'
  openButton.textContent = 'Open'
  openButton.href = createVideoTimestampUrl(normalizedItem)
  openButton.target = '_blank'
  openButton.rel = 'noreferrer'

  const removeButton = document.createElement('button')
  removeButton.type = 'button'
  removeButton.className = 'ghost-button'
  removeButton.textContent = 'Remove'
  removeButton.addEventListener('click', async () => {
    await removeSavedWord(normalizedItem.id)
    renderSaved()
    renderReview()
  })

  actions.append(detailButton, openButton, removeButton)
  card.append(title, meaning, meta, detail, actions)
  return card
}

function normalizeSavedItem(item) {
  return {
    id: item.id,
    word: item.word || '',
    phrase: item.phrase || '',
    sentence: item.sentence || '',
    dictionaryMeaning: item.dictionaryMeaning || '',
    contextualMeaning: item.contextualMeaning || '',
    sentenceTranslation: item.sentenceTranslation || '',
    usageNote: item.usageNote || '',
    partOfSpeech: item.partOfSpeech || '',
    exampleUsage: normalizeListDisplayValue(item.exampleUsage),
    otherMeanings: normalizeListDisplayValue(item.otherMeanings),
    synonyms: normalizeListDisplayValue(item.synonyms),
    antonyms: normalizeListDisplayValue(item.antonyms),
    collocations: normalizeListDisplayValue(item.collocations),
    register: item.register || '',
    nuanceNote: item.nuanceNote || '',
    commonMistake: item.commonMistake || '',
    phraseConfidence: normalizeConfidence(item.phraseConfidence ?? item.confidence),
    difficultyLevel: item.difficultyLevel || '',
    familiarityHint: item.familiarityHint || '',
    learnerLevelUsed: normalizeLearnerLevel(item.learnerLevelUsed || item.learnerLevel, ''),
    subtitleLanguageDetected: item.subtitleLanguageDetected || '',
    reviewStage: item.reviewStage || 'new',
    nextReviewAt: Number.isFinite(Number(item.nextReviewAt)) ? Number(item.nextReviewAt) : 0,
    lastReviewedAt: Number.isFinite(Number(item.lastReviewedAt)) ? Number(item.lastReviewedAt) : null,
    reviewCount: Number.isFinite(Number(item.reviewCount)) ? Number(item.reviewCount) : 0,
    easeScore: Number.isFinite(Number(item.easeScore)) ? Number(item.easeScore) : 2.5,
    lastResult: item.lastResult || '',
    source: item.source || '',
    videoTitle: item.videoTitle || '',
    videoUrl: item.videoUrl || '',
    videoId: item.videoId || extractYouTubeVideoId(item.videoUrl || ''),
    timestampSeconds: Number.isFinite(Number(item.timestampSeconds)) ? Number(item.timestampSeconds) : null,
    timestampLabel: item.timestampLabel || formatTimestampLabel(item.timestampSeconds),
    savedAt: item.savedAt || item.timestamp || null,
    timestamp: item.timestamp || item.savedAt || null,
    meaning: item.meaning || item.contextualMeaning || item.dictionaryMeaning || ''
  }
}

function appendDetailRow(parent, label, value) {
  const displayValue = normalizeListDisplayValue(value)
  if (!String(displayValue || '').trim()) return

  const row = document.createElement('div')
  row.className = 'card-detail-row'

  const labelEl = document.createElement('span')
  labelEl.className = 'card-detail-label'
  labelEl.textContent = label

  const valueEl = document.createElement('span')
  valueEl.className = 'card-detail-value'
  valueEl.textContent = displayValue

  row.append(labelEl, valueEl)
  parent.appendChild(row)
}

function normalizeListDisplayValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .join(', ')
  }

  return String(value || '').trim()
}

function normalizeConfidence(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(Math.max(number, 0), 1)
}

function createVideoTimestampUrl(item) {
  if (item.videoId) {
    const seconds = Number.isFinite(Number(item.timestampSeconds)) ? Number(item.timestampSeconds) : 0
    return `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}${seconds > 0 ? `&t=${seconds}s` : ''}`
  }

  return item.videoUrl || '#'
}

async function renderReview() {
  const summary = document.getElementById('review-summary')
  const container = document.getElementById('review-card')
  if (!summary || !container) return

  const savedItems = await getStorageValue(SAVED_WORDS_STORAGE_KEY, [])
  const normalizedItems = Array.isArray(savedItems)
    ? savedItems.map(normalizeSavedItem)
    : []
  const dueItems = normalizedItems.filter(isReviewDue)

  summary.textContent = `${dueItems.length} due item${dueItems.length === 1 ? '' : 's'} today`
  container.textContent = ''

  if (!normalizedItems.length) {
    container.appendChild(createEmptyState('Save words or phrases to start reviewing.'))
    return
  }

  if (!dueItems.length) {
    container.appendChild(createEmptyState('No reviews due right now.'))
    return
  }

  container.appendChild(createReviewCard(dueItems[0], savedItems))
}

function isReviewDue(item) {
  const nextReviewAt = Number(item.nextReviewAt || 0)
  return !Number.isFinite(nextReviewAt) || nextReviewAt <= Date.now()
}

function createReviewCard(item, allItems) {
  const card = document.createElement('article')
  card.className = 'card'

  const title = document.createElement('div')
  title.className = 'card-title'
  title.textContent = item.phrase || item.word || '-'

  const meta = document.createElement('div')
  meta.className = 'card-meta'
  meta.textContent = [
    item.videoTitle,
    item.timestampLabel,
    item.reviewCount ? `Reviewed ${item.reviewCount}x` : 'New review'
  ].filter(Boolean).join(' - ')

  const prompt = document.createElement('div')
  prompt.className = 'card-text'
  prompt.textContent = createReviewPrompt(item)

  const answer = document.createElement('div')
  answer.className = 'review-answer'
  answer.hidden = true
  appendDetailRow(answer, 'Meaning', item.dictionaryMeaning || item.meaning)
  appendDetailRow(answer, 'Context', item.contextualMeaning)
  appendDetailRow(answer, 'Translation', item.sentenceTranslation)
  appendDetailRow(answer, 'Example', item.exampleUsage)
  appendDetailRow(answer, 'Collocations', item.collocations)

  const actions = document.createElement('div')
  actions.className = 'card-actions'

  const revealButton = document.createElement('button')
  revealButton.type = 'button'
  revealButton.className = 'ghost-button is-primary'
  revealButton.textContent = 'Reveal'

  const reviewActions = document.createElement('div')
  reviewActions.className = 'review-actions'
  reviewActions.hidden = true

  const againButton = createReviewResultButton('Again', 'again', item, allItems)
  const goodButton = createReviewResultButton('Good', 'good', item, allItems)
  const easyButton = createReviewResultButton('Easy', 'easy', item, allItems)

  revealButton.addEventListener('click', () => {
    answer.hidden = false
    reviewActions.hidden = false
    revealButton.hidden = true
  })

  reviewActions.append(againButton, goodButton, easyButton)
  actions.append(revealButton, reviewActions)
  card.append(title, meta, prompt, answer, actions)

  return card
}

function createReviewPrompt(item) {
  if (!item.sentence) return 'Recall the meaning before revealing the card.'

  const selected = item.phrase || item.word
  if (!selected) return item.sentence

  const escaped = selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return item.sentence.replace(new RegExp(escaped, 'i'), '_____')
}

function createReviewResultButton(label, result, item, allItems) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'ghost-button'
  button.textContent = label
  button.addEventListener('click', async () => {
    await updateReviewItem(item.id, result, allItems)
    renderReview()
    renderSaved()
  })
  return button
}

async function updateReviewItem(id, result, allItems) {
  const nextItems = Array.isArray(allItems)
    ? allItems.map(item => {
      if (item.id !== id) return item
      return scheduleReviewItem(normalizeSavedItem(item), result)
    })
    : []

  await setStorageValue(SAVED_WORDS_STORAGE_KEY, nextItems)
}

function scheduleReviewItem(item, result) {
  const now = Date.now()
  const previousCount = Number(item.reviewCount || 0)
  const baseDays = result === 'again' ? 1 : result === 'easy' ? 7 : 3
  const multiplier = result === 'again' ? 1 : Math.max(1, Math.min(previousCount + 1, 4))
  const intervalDays = Math.min(baseDays * multiplier, 45)
  const easeDelta = result === 'again' ? -0.2 : result === 'easy' ? 0.2 : 0.05
  const nextEase = Math.min(Math.max(Number(item.easeScore || 2.5) + easeDelta, 1.3), 3.2)

  return {
    ...item,
    reviewStage: result,
    nextReviewAt: now + intervalDays * DAY_MS,
    lastReviewedAt: now,
    reviewCount: previousCount + 1,
    easeScore: nextEase,
    lastResult: result
  }
}

async function renderHistory() {
  const list = document.getElementById('history-list')
  const history = await getStorageValue(CLICK_HISTORY_STORAGE_KEY, [])
  list.textContent = ''

  if (!Array.isArray(history) || !history.length) {
    list.appendChild(createEmptyState('No learning history yet.'))
    return
  }

  for (const item of history) {
    list.appendChild(createHistoryCard(item))
  }
}

function createHistoryCard(item) {
  const card = document.createElement('article')
  card.className = 'card'

  const title = document.createElement('div')
  title.className = 'card-title'
  title.textContent = item.phrase || item.word || '-'

  const meta = document.createElement('div')
  meta.className = 'card-meta'
  meta.textContent = `Seen ${Number(item.seenCount || 1)}x - Last seen ${formatDate(item.lastSeenAt || item.timestamp)}`

  const sentence = document.createElement('div')
  sentence.className = 'card-text'
  sentence.textContent = item.sentence || ''

  card.append(title, meta, sentence)
  return card
}

function createEmptyState(text) {
  const empty = document.createElement('div')
  empty.className = 'empty'
  empty.textContent = text
  return empty
}

async function removeSavedWord(id) {
  const savedItems = await getStorageValue(SAVED_WORDS_STORAGE_KEY, [])
  const nextItems = Array.isArray(savedItems)
    ? savedItems.filter(item => item.id !== id)
    : []

  await setStorageValue(SAVED_WORDS_STORAGE_KEY, nextItems)
}

function getStorageValue(key, fallbackValue) {
  return new Promise(resolve => {
    chrome.storage.local.get([key], result => {
      const lastError = chrome.runtime.lastError
      if (lastError) {
        resolve(fallbackValue)
        return
      }

      resolve(typeof result[key] === 'undefined' ? fallbackValue : result[key])
    })
  })
}

function setStorageValue(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const lastError = chrome.runtime.lastError
      if (lastError) {
        reject(new Error(lastError.message))
        return
      }

      resolve()
    })
  })
}

function formatDate(value) {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp)) return ''

  return new Date(timestamp).toLocaleString()
}

function extractYouTubeVideoId(urlValue) {
  try {
    const url = new URL(urlValue)
    return url.searchParams.get('v') || ''
  } catch {
    return ''
  }
}

function formatTimestampLabel(secondsValue) {
  const seconds = Number(secondsValue)
  if (!Number.isFinite(seconds) || seconds < 0) return ''

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}
