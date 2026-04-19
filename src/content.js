(function () {
  const DEBUG = true
  const LOG_PREFIX = '[Subtitle Learning Prototype]'
  const CAPTION_LOG_PREFIX = '[Subtitle]'
  const WORD_LOG_PREFIX = '[Subtitle Word]'
  const OVERLAY_ID = 'subtitle-learning-prototype-overlay'
  const POPUP_ID = 'subtitle-learning-prototype-popup'
  const SETTINGS_STORAGE_KEY = 'subtitle_learning_prototype_settings_v1'
  const SAVED_WORDS_STORAGE_KEY = 'subtitle_learning_saved_words_v1'
  const CLICK_HISTORY_STORAGE_KEY = 'subtitle_learning_click_history_v1'
  const POPUP_POSITION_STORAGE_KEY = 'subtitle_learning_popup_position_v1'
  const POPUP_SIZE_STORAGE_KEY = 'subtitle_learning_popup_size_v1'
  const POPUP_PIN_STORAGE_KEY = 'subtitle_learning_popup_pin_v1'
  const HIDE_NATIVE_CAPTIONS_CLASS = 'slp-hide-native-captions'
  const MOCK_EXPLANATION_DELAY_MS = 350
  const MAX_HISTORY_ITEMS = 20
  const MAX_SUBTITLE_CONTEXT_LINES = 4
  const CAPTION_STALE_GRACE_MS = 1600
  const CAPTION_STALE_CLEAR_MS = 220
  const POPUP_MIN_WIDTH = 300
  const POPUP_MAX_WIDTH = 620
  const POPUP_MIN_HEIGHT = 260
  const POPUP_MAX_HEIGHT = 720
  const CAPTION_SIMILARITY_IGNORE_THRESHOLD = 0.8
  const COMMON_PHRASE_NEXT_WORDS = new Set([
    'about',
    'after',
    'at',
    'away',
    'back',
    'by',
    'down',
    'for',
    'from',
    'in',
    'into',
    'now',
    'of',
    'off',
    'on',
    'out',
    'over',
    'through',
    'to',
    'up',
    'with'
  ])
  const FIXED_CLICKABLE_PHRASES = [
    ['right', 'now'],
    ['over', 'time'],
    ['as', 'well', 'as'],
    ['look', 'at'],
    ['get', 'up'],
    ['take', 'off'],
    ['take', 'over'],
    ['turn', 'out'],
    ['go', 'on'],
    ['come', 'back'],
    ['set', 'up'],
    ['carry', 'out']
  ]
  const PROPER_NOUN_CONNECTORS = new Set(['of', 'the', 'and', 'for', 'in', 'on'])
  const TITLE_PHRASE_WORDS = new Set([
    'foreign',
    'minister',
    'prime',
    'president',
    'secretary',
    'general',
    'strait',
    'senator',
    'governor'
  ])
  const MESSAGE_TYPES = {
    REQUEST_WORD_EXPLANATION: 'REQUEST_WORD_EXPLANATION'
  }
  const EXPLANATION_CONFIG = {
    provider: 'future_api'
  }

  let settings = getDefaultSettings()
  let initialized = false
  let lastUrl = location.href
  let lastCaptionText = ''
  let lastRenderedCaptionText = ''
  let lastClearedCaptionText = ''
  let lastCaptionUpdateAt = 0
  let isCaptionStale = false
  let captionContextLines = []
  let urlObserver = null
  let captionObserver = null
  let captionStaleTimer = null
  let overlayEl = null
  let popupEl = null
  let savedWordsCache = []
  let learningHistoryCache = []
  let currentPopupData = null
  let popupDetailMode = false
  let popupPinned = false
  let popupPosition = null
  let popupSize = null
  let dragState = null
  let resizeState = null
  let lastCaptionEnableAttemptUrl = ''

  function isYouTubeWatchPage() {
    const url = new URL(location.href)
    return url.hostname === 'www.youtube.com' && url.pathname.startsWith('/watch')
  }

  async function init() {
    if (initialized) return
    if (!isYouTubeWatchPage()) return

    initialized = true
    lastCaptionText = ''
    lastRenderedCaptionText = ''
    lastClearedCaptionText = ''
    lastCaptionUpdateAt = 0
    isCaptionStale = false
    captionContextLines = []
    debugLog(LOG_PREFIX, 'content script initialized on YouTube watch page', {
      url: location.href
    })

    settings = await loadSettings()
    popupPinned = await loadPopupPinned()
    popupPosition = await loadPopupPosition()
    popupSize = await loadPopupSize()
    syncFeatureState()
  }

  function cleanup() {
    if (!initialized) return

    stopCaptionObserver()
    clearCaptionStaleTimer()
    removeOverlay()
    removePopup()
    document.documentElement.classList.remove(HIDE_NATIVE_CAPTIONS_CLASS)
    lastCaptionText = ''
    lastRenderedCaptionText = ''
    lastClearedCaptionText = ''
    lastCaptionUpdateAt = 0
    isCaptionStale = false
    captionContextLines = []
    initialized = false
    debugLog(LOG_PREFIX, 'cleaned up after leaving YouTube watch page')
  }

  function handleUrlChange() {
    const currentUrl = location.href
    if (currentUrl === lastUrl) return

    lastUrl = currentUrl

    if (isYouTubeWatchPage()) {
      if (initialized) {
        lastCaptionText = ''
        lastRenderedCaptionText = ''
        lastClearedCaptionText = ''
        lastCaptionUpdateAt = 0
        isCaptionStale = false
        captionContextLines = []
        syncFeatureState()
      } else {
        init()
      }
    } else {
      cleanup()
    }
  }

  function observeUrlChanges() {
    if (urlObserver) return

    urlObserver = new MutationObserver(handleUrlChange)
    urlObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    })

    window.addEventListener('popstate', handleUrlChange)
  }

  function observeStorageChanges() {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return

      if (changes[SETTINGS_STORAGE_KEY]) {
        handleSettingsStorageChange(changes[SETTINGS_STORAGE_KEY].newValue)
      }

      if (changes[SAVED_WORDS_STORAGE_KEY]) {
        savedWordsCache = Array.isArray(changes[SAVED_WORDS_STORAGE_KEY].newValue)
          ? changes[SAVED_WORDS_STORAGE_KEY].newValue
          : []
      }

      if (changes[CLICK_HISTORY_STORAGE_KEY]) {
        learningHistoryCache = Array.isArray(changes[CLICK_HISTORY_STORAGE_KEY].newValue)
          ? changes[CLICK_HISTORY_STORAGE_KEY].newValue
          : []
      }

      if ((changes[SAVED_WORDS_STORAGE_KEY] || changes[CLICK_HISTORY_STORAGE_KEY]) && lastCaptionText) {
        renderCaptionOverlay(lastCaptionText)
      }
    })
  }

  function handleSettingsStorageChange(nextSettings) {
    if (!nextSettings || typeof nextSettings !== 'object') return

    settings = normalizeSettings(nextSettings)
    syncFeatureState()
  }

  function syncFeatureState() {
    if (!settings.extensionEnabled || !isYouTubeWatchPage()) {
      disableContentFeatures()
      return
    }

    createOverlay()
    refreshLearningCaches()
    applySettings()
    startCaptionObserver()
    ensureYouTubeCaptionsEnabled()
  }

  function disableContentFeatures() {
    stopCaptionObserver()
    clearCaptionStaleTimer()
    removeOverlay()
    removePopup()
    document.documentElement.classList.remove(HIDE_NATIVE_CAPTIONS_CLASS)
    lastCaptionText = ''
    lastRenderedCaptionText = ''
    lastClearedCaptionText = ''
    lastCaptionUpdateAt = 0
    isCaptionStale = false
    captionContextLines = []
  }

  function ensureYouTubeCaptionsEnabled() {
    if (!settings.extensionEnabled || !settings.autoEnableCaptions) return
    if (lastCaptionEnableAttemptUrl === location.href) return

    lastCaptionEnableAttemptUrl = location.href

    window.setTimeout(() => {
      try {
        const button = document.querySelector('.ytp-subtitles-button')
        if (!button) return

        const isPressed = button.getAttribute('aria-pressed') === 'true' ||
          button.classList.contains('ytp-button-active')
        const label = String(button.getAttribute('aria-label') || button.getAttribute('title') || '')
        const unavailable = /unavailable|not available/i.test(label)

        if (!isPressed && !unavailable) {
          button.click()
        }
      } catch {
        // Best-effort YouTube control. Failing silently is safer than fighting the player UI.
      }
    }, 800)
  }

  function startCaptionObserver() {
    stopCaptionObserver()

    const target = document.querySelector('.html5-video-player') || document.body
    if (!target) return

    captionObserver = new MutationObserver(updateCurrentCaptionLine)
    captionObserver.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    })

    updateCurrentCaptionLine()
  }

  function stopCaptionObserver() {
    if (!captionObserver) return

    captionObserver.disconnect()
    captionObserver = null
  }

  function updateCurrentCaptionLine() {
    if (!initialized || !settings.extensionEnabled || !isYouTubeWatchPage()) return

    const captionText = cleanCaptionLine(getCurrentCaptionText())
    if (!captionText || shouldIgnoreCaptionUpdate(captionText)) return

    lastCaptionText = captionText
    lastClearedCaptionText = ''
    isCaptionStale = false
    lastCaptionUpdateAt = Date.now()
    rememberCaptionContextLine(captionText)
    debugLog(CAPTION_LOG_PREFIX, `current line: "${captionText}"`)
    renderCaptionOverlay(captionText)
    scheduleCaptionStaleCleanup()
  }

  function scheduleCaptionStaleCleanup() {
    clearCaptionStaleTimer()

    captionStaleTimer = window.setTimeout(() => {
      if (!lastCaptionUpdateAt) return
      if (isVideoPaused()) {
        scheduleCaptionStaleCleanup()
        return
      }

      const elapsed = Date.now() - lastCaptionUpdateAt
      if (elapsed < CAPTION_STALE_GRACE_MS) {
        scheduleCaptionStaleCleanup()
        return
      }

      const activeCaptionText = cleanCaptionLine(getCurrentCaptionText())
      if (activeCaptionText) {
        scheduleCaptionStaleCleanup()
        return
      }

      if (isCaptionStale || lastClearedCaptionText === lastRenderedCaptionText) return

      hideStaleCaptionOverlay()
    }, CAPTION_STALE_GRACE_MS)
  }

  function clearCaptionStaleTimer() {
    if (!captionStaleTimer) return

    window.clearTimeout(captionStaleTimer)
    captionStaleTimer = null
  }

  function hideStaleCaptionOverlay() {
    clearCaptionStaleTimer()
    isCaptionStale = true
    lastClearedCaptionText = lastRenderedCaptionText
    lastCaptionText = ''
    lastCaptionUpdateAt = 0

    if (!overlayEl) return

    overlayEl.classList.add('slp-overlay-stale')
    window.setTimeout(() => {
      if (!overlayEl?.classList.contains('slp-overlay-stale')) return
      overlayEl.textContent = ''
    }, CAPTION_STALE_CLEAR_MS)
  }

  function isVideoPaused() {
    const video = document.querySelector('video')
    return Boolean(video?.paused)
  }

  function rememberCaptionContextLine(captionText) {
    const normalized = normalizeCaptionText(captionText)
    if (!normalized) return

    const previousLine = captionContextLines[captionContextLines.length - 1]
    if (previousLine === normalized) return

    captionContextLines = [
      ...captionContextLines,
      normalized
    ].slice(-MAX_SUBTITLE_CONTEXT_LINES)
  }

  function getCurrentCaptionText() {
    const segments = Array.from(document.querySelectorAll('.ytp-caption-segment'))
      .map(segment => normalizeCaptionText(segment.textContent))
      .filter(Boolean)

    if (segments.length > 0) {
      return normalizeCaptionText(segments.join(' '))
    }

    const captionWindow = document.querySelector('.ytp-caption-window-container')
    if (!captionWindow) return ''

    return normalizeCaptionText(captionWindow.textContent)
  }

  function normalizeCaptionText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function cleanCaptionLine(rawText) {
    let text = normalizeCaptionText(rawText)
      .replace(/([!?.,])\1+/g, '$1')
      .replace(/\s+([!?.,])/g, '$1')
      .replace(/([!?.,])(?=\S)/g, '$1 ')
      .trim()

    if (!text) return ''

    text = collapseRepeatedSegments(text)
    text = collapseRepeatedShortWords(text)

    return normalizeCaptionText(text)
  }

  function collapseRepeatedSegments(text) {
    const segments = String(text || '').match(/[^.!?]+[.!?]*/g) || []
    const cleanedSegments = []

    for (const segment of segments) {
      const cleaned = normalizeCaptionText(segment)
      const previous = cleanedSegments[cleanedSegments.length - 1]

      if (!cleaned) continue
      if (previous && normalizeRepeatKey(previous) === normalizeRepeatKey(cleaned)) continue

      cleanedSegments.push(cleaned)
    }

    return cleanedSegments.join(' ')
  }

  function collapseRepeatedShortWords(text) {
    const words = getWordTokens(text)

    if (words.length >= 3) {
      const uniqueWords = new Set(words.map(word => word.toLowerCase()))
      if (uniqueWords.size === 1 && words[0].length <= 20) {
        const punctuation = /[.!?]$/.test(text.trim()) ? text.trim().slice(-1) : ''
        return `${words[0]}${punctuation}`
      }
    }

    return text.replace(/\b([A-Za-z][A-Za-z'-]{0,20})(?:\s+\1\b){2,}/gi, '$1')
  }

  function normalizeRepeatKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim()
  }

  function shouldIgnoreCaptionUpdate(nextCaptionText) {
    if (!lastCaptionText) return false
    if (nextCaptionText === lastCaptionText) return true

    const similarity = getCaptionSimilarity(lastCaptionText, nextCaptionText)
    const lengthDelta = Math.abs(lastCaptionText.length - nextCaptionText.length)
    const smallChangeLimit = Math.max(6, Math.round(lastCaptionText.length * 0.2))

    return similarity >= CAPTION_SIMILARITY_IGNORE_THRESHOLD && lengthDelta <= smallChangeLimit
  }

  function getCaptionSimilarity(previousText, nextText) {
    const previous = normalizeRepeatKey(previousText)
    const next = normalizeRepeatKey(nextText)

    if (!previous || !next) return 0
    if (previous === next) return 1

    const shorterLength = Math.min(previous.length, next.length)
    let samePrefixLength = 0

    while (
      samePrefixLength < shorterLength &&
      previous[samePrefixLength] === next[samePrefixLength]
    ) {
      samePrefixLength += 1
    }

    return samePrefixLength / Math.max(previous.length, next.length)
  }

  function createOverlay() {
    if (overlayEl && document.contains(overlayEl)) return

    const player = document.querySelector('.html5-video-player')
    if (!player) return

    overlayEl = document.createElement('div')
    overlayEl.id = OVERLAY_ID
    overlayEl.setAttribute('aria-label', 'Clickable subtitle prototype')

    player.appendChild(overlayEl)
    applyOverlaySettings()
  }

  function removeOverlay() {
    if (overlayEl) {
      overlayEl.remove()
      overlayEl = null
    }
  }

  function renderCaptionOverlay(text) {
    if (!settings.extensionEnabled) return
    createOverlay()
    if (!overlayEl) return

    const captionText = normalizeCaptionText(text)
    overlayEl.classList.remove('slp-overlay-stale')
    overlayEl.textContent = ''

    if (!captionText || !settings.overlayEnabled) return

    lastRenderedCaptionText = captionText

    const tokens = tokenizeCaption(captionText)
    const clickableUnits = buildClickableUnits(tokens, captionText)
    const fragment = document.createDocumentFragment()

    for (const token of clickableUnits) {
      const span = document.createElement('span')
      span.textContent = token.value

      if (token.type === 'word' || token.type === 'phrase') {
        const savedMatch = findSavedMatchForToken(token.phrase || token.word)
        const learnedMatch = findLearnedMatchForToken(token.phrase || token.word)
        span.className = getTokenClassName(savedMatch, learnedMatch)
        if (token.type === 'phrase') {
          span.classList.add('slp-token-phrase')
        }
        span.addEventListener('click', event => {
          event.stopPropagation()
          const phrase = token.phrase || detectPhraseForToken(captionText, token.wordIndex)
          debugLog(
            WORD_LOG_PREFIX,
            `selected: "${token.word}" | phrase: "${phrase || ''}" | sentence: "${captionText}"`
          )
          showWordPopup({
            word: token.word,
            phrase,
            sentence: captionText
          })
        })
      } else {
        span.className = 'slp-token slp-token-text'
      }

      fragment.appendChild(span)
    }

    overlayEl.appendChild(fragment)
  }

  async function refreshLearningCaches() {
    const [savedWords, learningHistory] = await Promise.all([
      getSavedWords(),
      getClickHistory()
    ])

    savedWordsCache = savedWords
    learningHistoryCache = learningHistory

    if (lastCaptionText) {
      renderCaptionOverlay(lastCaptionText)
    }
  }

  function getTokenClassName(savedMatch, learnedMatch) {
    const classNames = ['slp-token', 'slp-token-word']

    if (savedMatch) {
      classNames.push('slp-token-saved')
    } else if (learnedMatch) {
      classNames.push('slp-token-seen')
    }

    return classNames.join(' ')
  }

  function findSavedMatchForToken(value) {
    const tokenKey = normalizeRepeatKey(value)
    if (!tokenKey) return null

    return savedWordsCache.find(item => {
      return normalizeRepeatKey(item.word) === tokenKey ||
        getWordTokens(item.phrase).some(word => normalizeRepeatKey(word) === tokenKey)
    }) || null
  }

  function findLearnedMatchForToken(value) {
    const tokenKey = normalizeRepeatKey(value)
    if (!tokenKey) return null

    return learningHistoryCache.find(item => {
      return Number(item.seenCount) > 1 && (
        normalizeRepeatKey(item.word) === tokenKey ||
        getWordTokens(item.phrase).some(word => normalizeRepeatKey(word) === tokenKey)
      )
    }) || null
  }

  function updateSetting(key, value) {
    settings = {
      ...settings,
      [key]: value
    }

    saveSettings(settings)
    applySettings()

    if (lastCaptionText) {
      renderCaptionOverlay(lastCaptionText)
    }
  }

  function applySettings() {
    if (!settings.extensionEnabled) {
      disableContentFeatures()
      return
    }

    applyOverlaySettings()
    applyPopupSettings()
    applyNativeCaptionSetting()
  }

  function applyOverlaySettings() {
    if (!overlayEl) return

    overlayEl.style.display = settings.overlayEnabled ? '' : 'none'
    overlayEl.style.bottom = `${settings.bottomOffset}px`
    overlayEl.style.color = settings.textColor
    overlayEl.style.setProperty('--slp-overlay-text-color', settings.textColor)
    overlayEl.style.setProperty('--slp-overlay-hover-bg', hexToRgba(settings.textColor, 0.22))
    overlayEl.style.setProperty('--slp-overlay-accent-border', hexToRgba(settings.textColor, 0.52))
    overlayEl.style.fontSize = `${settings.fontSize}px`
    overlayEl.style.background = settings.backgroundEnabled
      ? hexToRgba(settings.backgroundColor, 0.72)
      : 'transparent'
  }

  function applyPopupSettings() {
    if (!popupEl) return

    const size = popupSize || {
      width: settings.popupWidth,
      height: settings.popupMaxHeight,
      isUserSized: false
    }

    popupEl.style.setProperty('--slp-popup-width', `${size.width}px`)
    popupEl.style.setProperty('--slp-popup-height', `${size.height}px`)
    popupEl.classList.toggle('slp-popup-user-sized', Boolean(size.isUserSized))
  }

  function applyNativeCaptionSetting() {
    document.documentElement.classList.toggle(
      HIDE_NATIVE_CAPTIONS_CLASS,
      Boolean(settings.extensionEnabled && settings.hideNativeCaptions)
    )
  }

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
      popupWidth: 360,
      popupMaxHeight: 320,
      nativeLanguage: 'tr',
      targetLanguage: 'en',
      subtitleLanguage: 'auto',
      explanationMode: 'deep',
      learnerLevel: 'B1',
      autoClosePopup: true
    }
  }

  async function loadSettings() {
    const storedSettings = await getStorageValue(SETTINGS_STORAGE_KEY, null)

    return normalizeSettings(storedSettings)
  }

  function normalizeSettings(value) {
    const defaults = getDefaultSettings()

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return defaults
    }

    const legacyNativeLanguage = typeof value.nativeLanguage === 'string' ? value.nativeLanguage : ''
    const legacyTargetLanguage = typeof value.targetLanguage === 'string' ? value.targetLanguage : ''
    const legacyLearnerLanguage = typeof value.learnerLanguage === 'string' ? value.learnerLanguage : ''
    const legacyExplanationLanguage = typeof value.explanationLanguage === 'string' ? value.explanationLanguage : ''
    const legacySubtitleLanguage = typeof value.subtitleLanguage === 'string' ? value.subtitleLanguage : ''

    return {
      ...defaults,
      ...value,
      nativeLanguage: legacyNativeLanguage || legacyExplanationLanguage || legacyLearnerLanguage || defaults.nativeLanguage,
      targetLanguage: legacyTargetLanguage || getLegacyTargetLanguage(legacySubtitleLanguage) || defaults.targetLanguage,
      subtitleLanguage: legacySubtitleLanguage || defaults.subtitleLanguage,
      learnerLevel: normalizeLearnerLevel(value.learnerLevel, defaults.learnerLevel),
      popupWidth: normalizeNumberSetting(value.popupWidth, defaults.popupWidth, 300, 620),
      popupMaxHeight: normalizeNumberSetting(value.popupMaxHeight, defaults.popupMaxHeight, 260, 720),
      extensionEnabled: typeof value.extensionEnabled === 'boolean' ? value.extensionEnabled : defaults.extensionEnabled,
      autoEnableCaptions: typeof value.autoEnableCaptions === 'boolean' ? value.autoEnableCaptions : defaults.autoEnableCaptions
    }
  }

  function getLegacyTargetLanguage(legacySubtitleLanguage) {
    if (!legacySubtitleLanguage || legacySubtitleLanguage === 'auto') return ''
    return legacySubtitleLanguage
  }

  function normalizeNumberSetting(value, fallbackValue, min, max) {
    const number = Number(value)
    if (!Number.isFinite(number)) return fallbackValue
    return clamp(Math.round(number), min, max)
  }

  function normalizeLearnerLevel(value, fallbackValue) {
    const level = String(value || '').trim().toUpperCase()
    return ['A2', 'B1', 'B2', 'C1'].includes(level) ? level : fallbackValue
  }

  async function saveSettings(nextSettings) {
    await setStorageValue(SETTINGS_STORAGE_KEY, nextSettings)
  }

  function hexToRgba(hex, alpha) {
    const clean = String(hex || '').replace('#', '')
    if (!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(0, 0, 0, ${alpha})`

    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)

    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  function tokenizeCaption(text) {
    const matches = String(text || '').match(/[A-Za-z]+(?:'[A-Za-z]+)?|[0-9]+(?:[.,:/-][0-9]+)*|\s+|[^\sA-Za-z0-9]+/g) || []
    let wordIndex = 0

    return matches.map(value => {
      const isWord = /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(value)
      const token = {
        value,
        type: isWord ? 'word' : 'text',
        wordIndex: isWord ? wordIndex : -1
      }

      if (isWord) {
        wordIndex += 1
      }

      return token
    })
  }

  function getWordTokens(text) {
    return String(text || '').match(/[A-Za-z]+(?:'[A-Za-z]+)?|[0-9]+(?:[.,:/-][0-9]+)*/g) || []
  }

  function buildClickableUnits(tokens, sentence) {
    const wordTokens = tokens
      .filter(token => token.type === 'word')
      .map(token => token.value)
    const units = []
    let tokenIndex = 0
    let wordIndex = 0

    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex]

      if (token.type !== 'word') {
        units.push(token)
        tokenIndex += 1
        continue
      }

      const phraseMatch = findClickablePhraseAt(wordTokens, wordIndex)

      if (phraseMatch) {
        const endTokenIndex = findTokenIndexForWordIndex(tokens, phraseMatch.endWordIndex)
        if (endTokenIndex === -1) {
          units.push(token)
          tokenIndex += 1
          wordIndex += 1
          continue
        }
        const value = tokens.slice(tokenIndex, endTokenIndex + 1).map(item => item.value).join('')
        const phrase = normalizeCaptionText(value)

        units.push({
          value,
          type: 'phrase',
          word: token.value,
          phrase,
          wordIndex
        })

        tokenIndex = endTokenIndex + 1
        wordIndex = phraseMatch.endWordIndex + 1
        continue
      }

      units.push({
        ...token,
        word: token.value,
        phrase: detectPhraseForToken(sentence, token.wordIndex)
      })
      tokenIndex += 1
      wordIndex += 1
    }

    return units
  }

  function findClickablePhraseAt(words, startIndex) {
    return findFixedPhraseAt(words, startIndex) ||
      findProperNounPhraseAt(words, startIndex) ||
      findTitlePhraseAt(words, startIndex)
  }

  function findFixedPhraseAt(words, startIndex) {
    const loweredWords = words.map(word => word.toLowerCase())

    for (const phraseWords of FIXED_CLICKABLE_PHRASES) {
      const matches = phraseWords.every((word, offset) => loweredWords[startIndex + offset] === word)
      if (matches) {
        return {
          endWordIndex: startIndex + phraseWords.length - 1
        }
      }
    }

    return null
  }

  function findProperNounPhraseAt(words, startIndex) {
    const firstWord = words[startIndex]
    if (!isCapitalizedWord(firstWord)) return null

    let endIndex = startIndex
    let strongWordCount = 1

    for (let index = startIndex + 1; index < Math.min(words.length, startIndex + 6); index += 1) {
      const word = words[index]
      const lower = word.toLowerCase()

      if (isCapitalizedWord(word) || TITLE_PHRASE_WORDS.has(lower)) {
        endIndex = index
        strongWordCount += 1
        continue
      }

      if (PROPER_NOUN_CONNECTORS.has(lower) && words[index + 1] && isCapitalizedWord(words[index + 1])) {
        endIndex = index
        continue
      }

      break
    }

    if (endIndex > startIndex && strongWordCount >= 2) {
      return {
        endWordIndex: endIndex
      }
    }

    return null
  }

  function findTitlePhraseAt(words, startIndex) {
    const firstWord = words[startIndex]
    const secondWord = words[startIndex + 1]
    if (!firstWord || !secondWord) return null

    const firstLower = firstWord.toLowerCase()
    const secondLower = secondWord.toLowerCase()
    const titleLike = TITLE_PHRASE_WORDS.has(firstLower) && TITLE_PHRASE_WORDS.has(secondLower)

    if (titleLike || (isCapitalizedWord(firstWord) && TITLE_PHRASE_WORDS.has(secondLower))) {
      return {
        endWordIndex: startIndex + 1
      }
    }

    return null
  }

  function findTokenIndexForWordIndex(tokens, targetWordIndex) {
    return tokens.findIndex(token => token.type === 'word' && token.wordIndex === targetWordIndex)
  }

  function isCapitalizedWord(word) {
    return /^[A-Z][A-Za-z'-]*$/.test(String(word || ''))
  }

  function detectPhraseForToken(sentence, selectedWordIndex) {
    const words = getWordTokens(sentence)
    const selectedWord = words[selectedWordIndex]
    if (!selectedWord) return ''

    const previousWord = words[selectedWordIndex - 1] || ''
    const nextWord = words[selectedWordIndex + 1] || ''
    const selectedLower = selectedWord.toLowerCase()
    const nextLower = nextWord.toLowerCase()

    if (nextWord && COMMON_PHRASE_NEXT_WORDS.has(nextLower)) {
      return `${selectedWord} ${nextWord}`
    }

    if (previousWord && COMMON_PHRASE_NEXT_WORDS.has(selectedLower)) {
      return `${previousWord} ${selectedWord}`
    }

    if (previousWord && nextWord && selectedWord.length <= 4) {
      return `${previousWord} ${selectedWord} ${nextWord}`
    }

    return ''
  }

  function createPopup() {
    if (popupEl && document.contains(popupEl)) return

    popupEl = document.createElement('div')
    popupEl.id = POPUP_ID
    popupEl.setAttribute('role', 'dialog')
    popupEl.setAttribute('aria-label', 'Selected word explanation')

    document.body.appendChild(popupEl)
    applyPopupSettings()
    applyPopupPosition()
  }

  function removePopup() {
    if (popupEl) {
      popupEl.remove()
      popupEl = null
    }

    document.removeEventListener('mousemove', handlePopupDrag)
    document.removeEventListener('mousemove', handlePopupResize)
    dragState = null
    resizeState = null
  }

  async function showWordPopup(selection) {
    if (!settings.extensionEnabled) return

    createPopup()
    if (!popupEl) return

    const normalizedSelection = normalizeSelection(selection)
    if (!popupPinned && settings.autoClosePopup) {
      resetPopupPosition()
      popupDetailMode = false
    }

    await addHistoryItem({
      word: normalizedSelection.word,
      phrase: normalizedSelection.phrase,
      sentence: normalizedSelection.sentence,
      timestamp: Date.now()
    }, { increment: true })
    learningHistoryCache = await getClickHistory()

    showLoadingPopup(normalizedSelection)

    try {
      const explanation = await requestWordExplanation(normalizedSelection)
      const enrichedExplanation = applyAiPhraseDecision(normalizedSelection, explanation)
      await addHistoryItem({
        word: enrichedExplanation.word,
        phrase: enrichedExplanation.phrase,
        sentence: enrichedExplanation.sentence,
        timestamp: Date.now()
      }, { increment: false })
      learningHistoryCache = await getClickHistory()
      renderCaptionOverlay(enrichedExplanation.sentence)
      renderPopupContent(enrichedExplanation)
    } catch (error) {
      showErrorPopup(normalizedSelection, error)
    }
  }

  function normalizeSelection(selection) {
    return {
      word: normalizeCaptionText(selection?.word),
      phrase: normalizeCaptionText(selection?.phrase),
      sentence: normalizeCaptionText(selection?.sentence)
    }
  }

  function showLoadingPopup(selection) {
    renderPopupContent({
      word: selection.word,
      phrase: selection.phrase,
      sentence: selection.sentence,
      bestPhrase: selection.phrase || selection.word,
      isPhrase: Boolean(selection.phrase),
      confidence: selection.phrase ? 0.45 : 0,
      dictionaryMeaning: 'Loading...',
      contextualMeaning: 'Requesting explanation...',
      sentenceTranslation: '',
      usageNote: '',
      partOfSpeech: '',
      exampleUsage: '',
      collocations: '',
      register: '',
      nuanceNote: '',
      commonMistake: '',
      phraseConfidence: selection.phrase ? 0.45 : 0,
      learnerLevelUsed: settings.learnerLevel,
      subtitleLanguageDetected: detectSubtitleLanguage(selection.sentence),
      difficultyLevel: '',
      familiarityHint: '',
      source: 'pending'
    })
  }

  function showErrorPopup(selection, error) {
    renderPopupContent({
      word: selection.word,
      phrase: selection.phrase,
      sentence: selection.sentence,
      bestPhrase: selection.phrase || selection.word,
      isPhrase: Boolean(selection.phrase),
      confidence: selection.phrase ? 0.45 : 0,
      dictionaryMeaning: 'Explanation unavailable',
      contextualMeaning: error?.message || 'Unknown explanation error',
      sentenceTranslation: '',
      usageNote: '',
      partOfSpeech: '',
      exampleUsage: '',
      collocations: '',
      register: '',
      nuanceNote: '',
      commonMistake: '',
      phraseConfidence: selection.phrase ? 0.45 : 0,
      learnerLevelUsed: settings.learnerLevel,
      subtitleLanguageDetected: detectSubtitleLanguage(selection.sentence),
      difficultyLevel: '',
      familiarityHint: '',
      source: 'error'
    })
  }

  async function requestWordExplanation(selection) {
    const lookupText = selection.phrase || selection.word

    try {
      if (EXPLANATION_CONFIG.provider === 'mock') {
        return await getMockExplanation(selection, selection.phrase || lookupText)
      }

      if (EXPLANATION_CONFIG.provider === 'future_api') {
        const explanation = await callFutureApi(selection.word, selection.sentence, selection.phrase)
        return {
          ...explanation,
          word: selection.word,
          phrase: selection.phrase,
          sentence: selection.sentence
        }
      }

      throw new Error(`Unsupported explanation provider: ${EXPLANATION_CONFIG.provider}`)
    } catch (error) {
      throw normalizeExplanationError(error)
    }
  }

  async function getMockExplanation(selection, lookupText) {
    await delay(MOCK_EXPLANATION_DELAY_MS)

    return {
      word: selection.word,
      phrase: selection.phrase,
      sentence: selection.sentence,
      bestPhrase: selection.phrase || selection.word,
      isPhrase: Boolean(selection.phrase),
      confidence: selection.phrase ? 0.45 : 0,
      dictionaryMeaning: `Mock dictionary meaning for "${lookupText}"`,
      contextualMeaning: `Mock contextual meaning for "${lookupText}" in this caption.`,
      sentenceTranslation: `Mock translation of: ${selection.sentence}`,
      usageNote: 'Mock learning note. Real AI is handled by the backend.',
      partOfSpeech: 'mock',
      exampleUsage: `Mock example with "${lookupText}".`,
      collocations: '',
      register: 'neutral',
      nuanceNote: 'Mock nuance note.',
      commonMistake: '',
      phraseConfidence: selection.phrase ? 0.45 : 0,
      learnerLevelUsed: settings.learnerLevel,
      subtitleLanguageDetected: detectSubtitleLanguage(selection.sentence),
      difficultyLevel: 'easy',
      familiarityHint: 'Mock familiarity hint.',
      source: 'mock'
    }
  }

  function applyAiPhraseDecision(selection, explanation) {
    const aiPhrase = normalizeCaptionText(explanation.bestPhrase)
    const shouldUseAiPhrase = Boolean(explanation.isPhrase && aiPhrase && normalizeRepeatKey(aiPhrase) !== normalizeRepeatKey(selection.word))
    const phrase = shouldUseAiPhrase ? aiPhrase : selection.phrase

    return {
      ...explanation,
      word: selection.word,
      phrase,
      sentence: selection.sentence,
      bestPhrase: aiPhrase || phrase || selection.word,
      isPhrase: shouldUseAiPhrase || Boolean(selection.phrase),
      confidence: normalizeConfidence(explanation.confidence),
      phraseConfidence: normalizeConfidence(explanation.phraseConfidence ?? explanation.confidence)
    }
  }

  function normalizeConfidence(value) {
    const number = Number(value)
    if (!Number.isFinite(number)) return 0
    return Math.min(Math.max(number, 0), 1)
  }

  async function callFutureApi(word, sentence, phrase = '') {
    const videoContext = getVideoContext()
    const subtitleLanguageDetected = detectSubtitleLanguage(sentence)
    const subtitleContext = buildSubtitleContext(sentence)

    return sendExplanationRequestToBackground({
      word,
      phrase,
      sentence,
      nativeLanguage: settings.nativeLanguage,
      targetLanguage: settings.targetLanguage,
      subtitleLanguageDetected,
      explanationMode: settings.explanationMode,
      learnerLevel: settings.learnerLevel,
      videoContext,
      subtitleContext
    })
  }

  function getVideoContext() {
    const video = document.querySelector('video')
    const timestampSeconds = video ? Math.round(video.currentTime) : null

    return {
      url: location.href,
      title: getVideoTitle(),
      videoUrl: getCanonicalVideoUrl(),
      videoTitle: getVideoTitle(),
      videoId: getYouTubeVideoId(location.href),
      timestamp: timestampSeconds,
      timestampSeconds,
      timestampLabel: formatTimestampLabel(timestampSeconds)
    }
  }

  function buildSubtitleContext(sentence) {
    const currentLine = normalizeCaptionText(sentence || lastCaptionText)
    const lines = captionContextLines.filter(Boolean)
    const currentIndex = lines.lastIndexOf(currentLine)
    const previousLines = currentIndex === -1
      ? lines.slice(-2)
      : lines.slice(Math.max(0, currentIndex - 2), currentIndex)

    return {
      previousLines,
      currentLine,
      nextLines: []
    }
  }

  function detectSubtitleLanguage(text) {
    return detectSubtitleLanguageFromTrack() ||
      detectSubtitleLanguageFromDom() ||
      fallbackDetectLanguageFromText(text) ||
      getInternalSubtitleLanguageFallback()
  }

  function detectSubtitleLanguageFromTrack() {
    const captionTrack = getYouTubeCaptionTrackFromPlayerResponse()
    if (captionTrack) return captionTrack

    const selectedMenuItem = document.querySelector(
      '.ytp-caption-window-container [lang], .ytp-caption-segment[lang], track[kind="subtitles"][srclang], track[kind="captions"][srclang]'
    )
    const lang = selectedMenuItem?.getAttribute('lang') || selectedMenuItem?.getAttribute('srclang')
    if (lang) return normalizeLanguageCode(lang)

    const activeTrack = Array.from(document.querySelectorAll('video track')).find(track => {
      return track.track?.mode === 'showing' || track.getAttribute('default') !== null
    })
    const activeLang = activeTrack?.getAttribute('srclang') || activeTrack?.track?.language

    return normalizeLanguageCode(activeLang)
  }

  function getYouTubeCaptionTrackFromPlayerResponse() {
    try {
      const tracks = window.ytInitialPlayerResponse
        ?.captions
        ?.playerCaptionsTracklistRenderer
        ?.captionTracks

      if (!Array.isArray(tracks) || !tracks.length) return ''

      const track = tracks.find(item => item?.vssId && !String(item.vssId).startsWith('a.')) || tracks[0]
      return normalizeLanguageCode(track?.languageCode)
    } catch {
      return ''
    }
  }

  function detectSubtitleLanguageFromDom() {
    const captionLangEl = document.querySelector('.ytp-caption-window-container [lang], .ytp-caption-segment[lang]')
    const lang = captionLangEl?.getAttribute('lang')
    if (lang) return normalizeLanguageCode(lang)

    const playerLang = document.querySelector('.html5-video-player')?.getAttribute('lang')
    return normalizeLanguageCode(playerLang)
  }

  function fallbackDetectLanguageFromText(text) {
    const value = normalizeCaptionText(text).toLowerCase()
    if (!value) return ''

    if (/[ğüşöçıİ]/i.test(value) || /\b(bir|ve|bu|icin|için|degil|değil|olarak|ama|cok|çok)\b/i.test(value)) {
      return 'tr'
    }

    if (/[¿¡ñáéíóú]/i.test(value) || /\b(el|la|los|las|que|para|con|una|pero)\b/i.test(value)) {
      return 'es'
    }

    if (/[äöüß]/i.test(value) || /\b(der|die|das|und|nicht|mit|ein|eine|aber)\b/i.test(value)) {
      return 'de'
    }

    if (/\b(the|and|you|that|with|for|this|not|are|is)\b/i.test(value)) {
      return 'en'
    }

    return ''
  }

  function getInternalSubtitleLanguageFallback() {
    if (settings.subtitleLanguage && settings.subtitleLanguage !== 'auto') {
      return settings.subtitleLanguage
    }

    return settings.targetLanguage || 'auto'
  }

  function normalizeLanguageCode(value) {
    const lang = String(value || '').trim().toLowerCase()
    if (!lang) return ''
    return lang.split(/[-_]/)[0].slice(0, 12)
  }

  function getCanonicalVideoUrl() {
    const videoId = getYouTubeVideoId(location.href)
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href
  }

  function getYouTubeVideoId(urlValue) {
    try {
      const url = new URL(urlValue)
      return url.searchParams.get('v') || ''
    } catch {
      return ''
    }
  }

  function getVideoTitle() {
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string')
    const title = normalizeCaptionText(titleEl?.textContent)
    return title || normalizeCaptionText(document.title.replace(/ - YouTube$/i, ''))
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

  function sendExplanationRequestToBackground(request) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        reject(new Error('Extension background messaging is unavailable.'))
        return
      }

      chrome.runtime.sendMessage(
        {
          type: MESSAGE_TYPES.REQUEST_WORD_EXPLANATION,
          request
        },
        response => {
          const lastError = chrome.runtime.lastError
          if (lastError) {
            reject(new Error(lastError.message))
            return
          }

          if (!response || typeof response !== 'object') {
            reject(new Error('Background returned an invalid response.'))
            return
          }

          if (response.ok === false) {
            reject(createBackgroundContractError(response.error))
            return
          }

          if (response.ok !== true || !response.data || typeof response.data !== 'object') {
            reject(new Error('Background returned an invalid contract response.'))
            return
          }

          resolve(response.data)
        }
      )
    })
  }

  function createBackgroundContractError(error) {
    const message = error?.message || 'Background explanation request failed.'
    const normalizedError = new Error(message)
    normalizedError.code = error?.code || 'BACKGROUND_ERROR'
    return normalizedError
  }

  function normalizeExplanationError(error) {
    if (error instanceof Error) return error
    return new Error(String(error || 'Unknown explanation error'))
  }

  function delay(ms) {
    return new Promise(resolve => {
      window.setTimeout(resolve, ms)
    })
  }

  function renderPopupContent({
    word,
    phrase,
    sentence,
    dictionaryMeaning,
    contextualMeaning,
    sentenceTranslation,
    usageNote,
    partOfSpeech,
    exampleUsage,
    collocations,
    register,
    nuanceNote,
    commonMistake,
    bestPhrase,
    isPhrase,
    confidence,
    phraseConfidence,
    difficultyLevel,
    familiarityHint,
    learnerLevelUsed,
    subtitleLanguageDetected,
    source
  }) {
    currentPopupData = {
      word,
      phrase,
      sentence,
      dictionaryMeaning,
      contextualMeaning,
      sentenceTranslation,
      usageNote,
      partOfSpeech,
      exampleUsage,
      collocations,
      register,
      nuanceNote,
      commonMistake,
      bestPhrase,
      isPhrase,
      confidence,
      phraseConfidence,
      difficultyLevel,
      familiarityHint,
      learnerLevelUsed,
      subtitleLanguageDetected,
      source
    }

    popupEl.textContent = ''
    popupEl.classList.toggle('slp-popup-pinned', popupPinned)

    const header = document.createElement('div')
    header.className = 'slp-popup-header'
    header.addEventListener('mousedown', startPopupDrag)

    const title = document.createElement('strong')
    title.textContent = 'Word'

    const actions = document.createElement('div')
    actions.className = 'slp-popup-actions'

    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.className = 'slp-popup-action-button'
    saveButton.textContent = 'Save'
    saveButton.disabled = source === 'pending' || source === 'error'
    saveButton.addEventListener('click', event => {
      event.stopPropagation()
      handleSaveCurrentItem(saveButton)
    })

    const detailButton = document.createElement('button')
    detailButton.type = 'button'
    detailButton.className = 'slp-popup-action-button'
    detailButton.textContent = popupDetailMode ? 'Show less' : 'Show more'
    detailButton.addEventListener('click', event => {
      event.stopPropagation()
      popupDetailMode = !popupDetailMode
      renderPopupContent(currentPopupData)
    })

    const pinButton = document.createElement('button')
    pinButton.type = 'button'
    pinButton.className = popupPinned
      ? 'slp-popup-action-button slp-popup-action-button-active'
      : 'slp-popup-action-button'
    pinButton.textContent = popupPinned ? 'Pinned' : 'Pin'
    pinButton.addEventListener('click', event => {
      event.stopPropagation()
      togglePopupPin()
      renderPopupContent(currentPopupData)
    })

    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'slp-popup-close'
    closeButton.textContent = 'x'
    closeButton.disabled = popupPinned
    closeButton.title = popupPinned ? 'Unpin to close' : 'Close popup'
    closeButton.setAttribute('aria-label', popupPinned ? 'Popup is pinned' : 'Close popup')
    closeButton.addEventListener('click', event => {
      event.stopPropagation()
      if (popupPinned) return
      removePopup()
    })

    actions.append(saveButton, detailButton, pinButton, closeButton)
    header.append(title, actions)

    const body = document.createElement('div')
    body.className = 'slp-popup-body'
    const selectedText = phrase || bestPhrase || word
    const rows = [
      createPopupRow('Selected word / phrase', selectedText, { compact: true }),
      createPopupRow('Meaning', dictionaryMeaning, { clamp: 1 }),
      createPopupRow('Sentence translation', sentenceTranslation, { clamp: 2 })
    ].filter(Boolean)

    if (popupDetailMode) {
      rows.push(
        createPopupSection('Context', [
          createPopupRow('Contextual meaning', contextualMeaning),
          createPopupRow('Register', register),
          createPopupRow('Nuance', nuanceNote)
        ]),
        createPopupSection('Usage', [
          createPopupRow('Usage note', usageNote),
          createPopupRow('Example usage', exampleUsage),
          createPopupRow('Collocations', collocations)
        ]),
        createPopupSection('Learn carefully', [
          createPopupRow('Common mistake', commonMistake),
          createPopupRow('Part of speech', partOfSpeech),
          createPopupRow('Difficulty', difficultyLevel),
          createPopupRow('Familiarity hint', familiarityHint),
          createPopupRow('Phrase confidence', formatConfidence(phraseConfidence || confidence)),
          createPopupRow('Source', source)
        ])
      )
    }

    body.append(...rows.filter(Boolean))

    popupEl.append(
      header,
      body,
      createPopupResizeHandle('right'),
      createPopupResizeHandle('bottom'),
      createPopupResizeHandle('corner')
    )
  }

  function createPopupResizeHandle(direction) {
    const resizeHandle = document.createElement('div')
    resizeHandle.className = `slp-popup-resize-handle slp-popup-resize-${direction}`
    resizeHandle.dataset.resizeDirection = direction
    resizeHandle.setAttribute('aria-hidden', 'true')
    resizeHandle.addEventListener('mousedown', startPopupResize)
    return resizeHandle
  }

  function createPopupSection(title, rows) {
    const visibleRows = rows.filter(Boolean)
    if (!visibleRows.length) return null

    const section = document.createElement('section')
    section.className = 'slp-popup-section'

    const titleEl = document.createElement('div')
    titleEl.className = 'slp-popup-section-title'
    titleEl.textContent = title

    section.append(titleEl, ...visibleRows)
    return section
  }

  function createPopupRow(label, value, options = {}) {
    const displayValue = normalizeListDisplayValue(value)
    if (!hasDisplayValue(displayValue)) return null

    const row = document.createElement('div')
    row.className = 'slp-popup-row'
    if (options.compact) {
      row.classList.add('slp-popup-row-compact')
    }

    const labelEl = document.createElement('span')
    labelEl.className = 'slp-popup-label'
    labelEl.textContent = label

    const valueEl = document.createElement('span')
    valueEl.className = 'slp-popup-value'
    if (options.clamp === 1) {
      valueEl.classList.add('slp-popup-value-one-line')
    } else if (options.clamp === 2) {
      valueEl.classList.add('slp-popup-value-two-line')
    }
    valueEl.textContent = displayValue

    row.append(labelEl, valueEl)
    return row
  }

  function hasDisplayValue(value) {
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value === 'boolean') return true
    return Boolean(String(value || '').trim() && String(value || '').trim() !== '-')
  }

  function normalizeListDisplayValue(value) {
    if (Array.isArray(value)) {
      return value
        .map(item => normalizeCaptionText(item))
        .filter(Boolean)
        .join(', ')
    }

    return normalizeCaptionText(value)
  }

  function formatConfidence(value) {
    const confidence = normalizeConfidence(value)
    if (!confidence) return '-'
    return `${Math.round(confidence * 100)}%`
  }

  async function handleSaveCurrentItem(buttonEl) {
    if (!currentPopupData || currentPopupData.source === 'pending' || currentPopupData.source === 'error') return

    buttonEl.disabled = true
    buttonEl.textContent = 'Saving...'

    try {
      const result = await saveWord(createSavedItemFromPopupData(currentPopupData))
      savedWordsCache = result.items

      buttonEl.textContent = result.saved ? 'Saved' : 'Already saved'
      if (lastCaptionText) {
        renderCaptionOverlay(lastCaptionText)
      }
    } catch (error) {
      buttonEl.disabled = false
      buttonEl.textContent = 'Save failed'
      debugLog(LOG_PREFIX, 'save failed', error)
    }
  }

  function createSavedItemFromPopupData(data) {
    const videoContext = getVideoContext()
    const savedAt = Date.now()

    return {
      id: createSavedWordId({
        word: data.word,
        phrase: data.phrase,
        sentence: data.sentence,
        timestamp: savedAt
      }),
      word: data.word || '',
      phrase: data.phrase || '',
      sentence: data.sentence || '',
      dictionaryMeaning: data.dictionaryMeaning || '',
      contextualMeaning: data.contextualMeaning || '',
      sentenceTranslation: data.sentenceTranslation || '',
      usageNote: data.usageNote || '',
      partOfSpeech: data.partOfSpeech || '',
      exampleUsage: normalizeListDisplayValue(data.exampleUsage),
      otherMeanings: normalizeListDisplayValue(data.otherMeanings),
      synonyms: normalizeListDisplayValue(data.synonyms),
      antonyms: normalizeListDisplayValue(data.antonyms),
      collocations: normalizeListDisplayValue(data.collocations),
      register: data.register || '',
      nuanceNote: data.nuanceNote || '',
      commonMistake: data.commonMistake || '',
      phraseConfidence: normalizeConfidence(data.phraseConfidence ?? data.confidence),
      difficultyLevel: data.difficultyLevel || '',
      familiarityHint: data.familiarityHint || '',
      learnerLevelUsed: data.learnerLevelUsed || settings.learnerLevel,
      subtitleLanguageDetected: data.subtitleLanguageDetected || detectSubtitleLanguage(data.sentence || lastCaptionText),
      source: data.source || '',
      videoTitle: videoContext.videoTitle,
      videoUrl: videoContext.videoUrl,
      videoId: videoContext.videoId,
      timestampSeconds: videoContext.timestampSeconds,
      timestampLabel: videoContext.timestampLabel,
      savedAt,
      reviewStage: 'new',
      nextReviewAt: savedAt,
      lastReviewedAt: null,
      reviewCount: 0,
      easeScore: 2.5,
      lastResult: '',
      meaning: data.contextualMeaning || data.dictionaryMeaning || ''
    }
  }

  async function saveWord(item) {
    const savedWords = await getSavedWords()
    const normalizedItem = {
      id: item.id || createSavedWordId(item),
      word: normalizeCaptionText(item.word),
      phrase: normalizeCaptionText(item.phrase),
      sentence: normalizeCaptionText(item.sentence),
      dictionaryMeaning: normalizeCaptionText(item.dictionaryMeaning),
      contextualMeaning: normalizeCaptionText(item.contextualMeaning),
      sentenceTranslation: normalizeCaptionText(item.sentenceTranslation),
      usageNote: normalizeCaptionText(item.usageNote),
      partOfSpeech: normalizeCaptionText(item.partOfSpeech),
      exampleUsage: normalizeListDisplayValue(item.exampleUsage),
      otherMeanings: normalizeListDisplayValue(item.otherMeanings),
      synonyms: normalizeListDisplayValue(item.synonyms),
      antonyms: normalizeListDisplayValue(item.antonyms),
      collocations: normalizeListDisplayValue(item.collocations),
      register: normalizeCaptionText(item.register),
      nuanceNote: normalizeCaptionText(item.nuanceNote),
      commonMistake: normalizeCaptionText(item.commonMistake),
      phraseConfidence: normalizeConfidence(item.phraseConfidence ?? item.confidence),
      difficultyLevel: normalizeCaptionText(item.difficultyLevel),
      familiarityHint: normalizeCaptionText(item.familiarityHint),
      learnerLevelUsed: normalizeLearnerLevel(item.learnerLevelUsed || item.learnerLevel, settings.learnerLevel),
      subtitleLanguageDetected: normalizeCaptionText(item.subtitleLanguageDetected),
      source: normalizeCaptionText(item.source),
      videoTitle: normalizeCaptionText(item.videoTitle),
      videoUrl: String(item.videoUrl || ''),
      videoId: normalizeCaptionText(item.videoId),
      timestampSeconds: Number.isFinite(Number(item.timestampSeconds)) ? Number(item.timestampSeconds) : null,
      timestampLabel: normalizeCaptionText(item.timestampLabel),
      savedAt: Number(item.savedAt) || Date.now(),
      reviewStage: normalizeCaptionText(item.reviewStage || 'new'),
      nextReviewAt: Number.isFinite(Number(item.nextReviewAt)) ? Number(item.nextReviewAt) : Date.now(),
      lastReviewedAt: Number.isFinite(Number(item.lastReviewedAt)) ? Number(item.lastReviewedAt) : null,
      reviewCount: Number.isFinite(Number(item.reviewCount)) ? Number(item.reviewCount) : 0,
      easeScore: Number.isFinite(Number(item.easeScore)) ? Number(item.easeScore) : 2.5,
      lastResult: normalizeCaptionText(item.lastResult),
      meaning: normalizeCaptionText(item.meaning || item.contextualMeaning || item.dictionaryMeaning),
      timestamp: Number(item.timestamp || item.savedAt) || Date.now()
    }

    const exists = savedWords.some(savedItem => {
      return normalizeRepeatKey(savedItem.word) === normalizeRepeatKey(normalizedItem.word) &&
        normalizeRepeatKey(savedItem.sentence) === normalizeRepeatKey(normalizedItem.sentence)
    })

    if (exists) {
      return {
        saved: false,
        items: savedWords
      }
    }

    const nextSavedWords = [normalizedItem, ...savedWords]
    await setStorageValue(SAVED_WORDS_STORAGE_KEY, nextSavedWords)

    return {
      saved: true,
      items: nextSavedWords
    }
  }

  async function getSavedWords() {
    const value = await getStorageValue(SAVED_WORDS_STORAGE_KEY, [])
    return Array.isArray(value) ? value : []
  }

  async function removeSavedWord(id) {
    const savedWords = await getSavedWords()
    const nextSavedWords = savedWords.filter(item => item.id !== id)
    await setStorageValue(SAVED_WORDS_STORAGE_KEY, nextSavedWords)
    return nextSavedWords
  }

  async function addHistoryItem(item, options = {}) {
    const history = await getClickHistory()
    const shouldIncrement = options.increment !== false
    const normalizedItem = {
      id: createSavedWordId(item),
      word: normalizeCaptionText(item.word),
      phrase: normalizeCaptionText(item.phrase),
      sentence: normalizeCaptionText(item.sentence),
      seenCount: 1,
      lastSeenAt: Number(item.timestamp) || Date.now(),
      timestamp: Number(item.timestamp) || Date.now()
    }

    const existingIndex = history.findIndex(historyItem => {
      return normalizeRepeatKey(historyItem.word) === normalizeRepeatKey(normalizedItem.word)
    })

    if (existingIndex !== -1) {
      const existingItem = history[existingIndex]
      const updatedItem = {
        ...existingItem,
        phrase: normalizedItem.phrase || existingItem.phrase || '',
        sentence: normalizedItem.sentence || existingItem.sentence || '',
        seenCount: Number(existingItem.seenCount || 1) + (shouldIncrement ? 1 : 0),
        lastSeenAt: normalizedItem.lastSeenAt,
        timestamp: existingItem.timestamp || normalizedItem.timestamp
      }
      const nextHistory = [
        updatedItem,
        ...history.slice(0, existingIndex),
        ...history.slice(existingIndex + 1)
      ].slice(0, MAX_HISTORY_ITEMS)

      await setStorageValue(CLICK_HISTORY_STORAGE_KEY, nextHistory)
      return nextHistory
    }

    const nextHistory = [normalizedItem, ...history].slice(0, MAX_HISTORY_ITEMS)
    await setStorageValue(CLICK_HISTORY_STORAGE_KEY, nextHistory)
    return nextHistory
  }

  async function getClickHistory() {
    const value = await getStorageValue(CLICK_HISTORY_STORAGE_KEY, [])
    return Array.isArray(value) ? value : []
  }

  function createSavedWordId(item) {
    const base = `${item.word || ''}|${item.phrase || ''}|${item.sentence || ''}|${item.timestamp || Date.now()}`
    return `${Date.now()}-${Math.abs(hashString(base))}`
  }

  function hashString(value) {
    let hash = 0
    const text = String(value || '')

    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index)
      hash |= 0
    }

    return hash
  }

  function getStorageValue(key, fallbackValue) {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        resolve(fallbackValue)
        return
      }

      chrome.storage.local.get([key], result => {
        const lastError = chrome.runtime?.lastError
        if (lastError) {
          debugLog(LOG_PREFIX, `storage get failed for ${key}`, lastError)
          resolve(fallbackValue)
          return
        }

        resolve(typeof result[key] === 'undefined' ? fallbackValue : result[key])
      })
    })
  }

  function setStorageValue(key, value) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        resolve()
        return
      }

      chrome.storage.local.set({ [key]: value }, () => {
        const lastError = chrome.runtime?.lastError
        if (lastError) {
          reject(new Error(lastError.message))
          return
        }

        resolve()
      })
    })
  }

  function startPopupDrag(event) {
    const targetEl = event.target instanceof Element ? event.target : null
    if (!popupEl || event.button !== 0 || targetEl?.closest('button') || targetEl?.closest('.slp-popup-resize-handle')) return

    const rect = popupEl.getBoundingClientRect()
    dragState = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    }

    popupEl.classList.add('slp-popup-dragging')
    document.addEventListener('mousemove', handlePopupDrag)
    document.addEventListener('mouseup', stopPopupDrag, { once: true })
    event.preventDefault()
  }

  function handlePopupDrag(event) {
    if (!popupEl || !dragState) return

    const nextLeft = clamp(event.clientX - dragState.offsetX, 8, Math.max(8, window.innerWidth - popupEl.offsetWidth - 8))
    const nextTop = clamp(event.clientY - dragState.offsetY, 8, Math.max(8, window.innerHeight - popupEl.offsetHeight - 8))

    popupPosition = {
      left: nextLeft,
      top: nextTop
    }

    applyPopupPosition()
  }

  function stopPopupDrag() {
    if (popupEl) {
      popupEl.classList.remove('slp-popup-dragging')
    }

    document.removeEventListener('mousemove', handlePopupDrag)
    dragState = null
    savePopupPosition(popupPosition)
  }

  function startPopupResize(event) {
    if (!popupEl || event.button !== 0) return

    const targetEl = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    const rect = popupEl.getBoundingClientRect()
    popupPosition = {
      left: rect.left,
      top: rect.top
    }

    resizeState = {
      direction: targetEl?.dataset.resizeDirection || 'corner',
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height
    }

    popupEl.classList.add('slp-popup-resizing')
    applyPopupPosition()
    document.addEventListener('mousemove', handlePopupResize)
    document.addEventListener('mouseup', stopPopupResize, { once: true })
    event.preventDefault()
    event.stopPropagation()
  }

  function handlePopupResize(event) {
    if (!popupEl || !resizeState) return

    const maxWidth = getPopupMaxWidth()
    const maxHeight = getPopupMaxHeight()
    const canResizeWidth = ['right', 'corner'].includes(resizeState.direction)
    const canResizeHeight = ['bottom', 'corner'].includes(resizeState.direction)
    const width = canResizeWidth
      ? clamp(resizeState.startWidth + event.clientX - resizeState.startX, POPUP_MIN_WIDTH, maxWidth)
      : resizeState.startWidth
    const height = canResizeHeight
      ? clamp(resizeState.startHeight + event.clientY - resizeState.startY, POPUP_MIN_HEIGHT, maxHeight)
      : resizeState.startHeight

    popupSize = {
      width: Math.round(width),
      height: Math.round(height),
      isUserSized: true
    }

    applyPopupSettings()
    applyPopupPosition()
  }

  function stopPopupResize() {
    if (popupEl) {
      popupEl.classList.remove('slp-popup-resizing')
    }

    document.removeEventListener('mousemove', handlePopupResize)
    resizeState = null
    savePopupSize(popupSize)
  }

  function togglePopupPin() {
    popupPinned = !popupPinned
    savePopupPinned(popupPinned)

    if (popupPinned && popupEl) {
      const rect = popupEl.getBoundingClientRect()
      popupPosition = {
        left: rect.left,
        top: rect.top
      }
      savePopupPosition(popupPosition)
    }
  }

  function applyPopupPosition() {
    if (!popupEl || !popupPosition) return

    const left = clamp(popupPosition.left, 8, Math.max(8, window.innerWidth - popupEl.offsetWidth - 8))
    const top = clamp(popupPosition.top, 8, Math.max(8, window.innerHeight - popupEl.offsetHeight - 8))

    popupPosition = {
      left,
      top
    }

    popupEl.style.left = `${left}px`
    popupEl.style.top = `${top}px`
    popupEl.style.right = 'auto'
    popupEl.style.bottom = 'auto'
  }

  function resetPopupPosition() {
    popupPosition = null

    setStorageValue(POPUP_POSITION_STORAGE_KEY, null).catch(error => {
      debugLog(LOG_PREFIX, 'popup position reset failed', error)
    })

    if (!popupEl) return

    popupEl.style.left = ''
    popupEl.style.top = ''
    popupEl.style.right = ''
    popupEl.style.bottom = ''
  }

  async function loadPopupPosition() {
    const parsed = await getStorageValue(POPUP_POSITION_STORAGE_KEY, null)
    if (!parsed || typeof parsed !== 'object') return null

    const left = Number(parsed.left)
    const top = Number(parsed.top)

    if (!Number.isFinite(left) || !Number.isFinite(top)) return null

    return {
      left,
      top
    }
  }

  function savePopupPosition(position) {
    if (!position) return
    setStorageValue(POPUP_POSITION_STORAGE_KEY, position).catch(error => {
      debugLog(LOG_PREFIX, 'popup position save failed', error)
    })
  }

  async function loadPopupSize() {
    const parsed = await getStorageValue(POPUP_SIZE_STORAGE_KEY, null)
    if (!parsed || typeof parsed !== 'object') return null

    const width = clamp(Number(parsed.width), POPUP_MIN_WIDTH, POPUP_MAX_WIDTH)
    const height = clamp(Number(parsed.height), POPUP_MIN_HEIGHT, POPUP_MAX_HEIGHT)

    if (!Number.isFinite(width) || !Number.isFinite(height)) return null

    return {
      width,
      height,
      isUserSized: true
    }
  }

  function savePopupSize(size) {
    if (!size) return

    const nextSize = {
      width: clamp(Number(size.width), POPUP_MIN_WIDTH, POPUP_MAX_WIDTH),
      height: clamp(Number(size.height), POPUP_MIN_HEIGHT, POPUP_MAX_HEIGHT)
    }

    setStorageValue(POPUP_SIZE_STORAGE_KEY, nextSize).catch(error => {
      debugLog(LOG_PREFIX, 'popup size save failed', error)
    })
  }

  function getPopupMaxWidth() {
    if (!popupEl) return POPUP_MAX_WIDTH
    const left = popupEl.getBoundingClientRect().left
    return Math.min(POPUP_MAX_WIDTH, Math.max(POPUP_MIN_WIDTH, window.innerWidth - left - 8))
  }

  function getPopupMaxHeight() {
    if (!popupEl) return POPUP_MAX_HEIGHT
    const top = popupEl.getBoundingClientRect().top
    return Math.min(POPUP_MAX_HEIGHT, Math.max(POPUP_MIN_HEIGHT, window.innerHeight - top - 8))
  }

  async function loadPopupPinned() {
    return Boolean(await getStorageValue(POPUP_PIN_STORAGE_KEY, false))
  }

  function savePopupPinned(isPinned) {
    setStorageValue(POPUP_PIN_STORAGE_KEY, Boolean(isPinned)).catch(error => {
      debugLog(LOG_PREFIX, 'popup pin save failed', error)
    })
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
  }

  function debugLog(prefix, message, data) {
    if (!DEBUG) return

    if (typeof data === 'undefined') {
      console.log(`${prefix} ${message}`)
      return
    }

    console.log(`${prefix} ${message}`, data)
  }

  debugLog(LOG_PREFIX, 'content script loaded', {
    url: location.href,
    isWatchPage: isYouTubeWatchPage()
  })

  observeUrlChanges()
  observeStorageChanges()
  init()
})()
