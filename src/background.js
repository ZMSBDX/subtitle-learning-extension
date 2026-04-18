const MESSAGE_TYPES = {
  REQUEST_WORD_EXPLANATION: 'REQUEST_WORD_EXPLANATION'
}

const BETA_ACCESS_STORAGE_KEY = 'subtitle_learning_beta_access_code_v1'
const BACKEND_URL_STORAGE_KEY = 'subtitle_learning_backend_url_v1'
const MOCK_EXPLANATION_DELAY_MS = 350
const BACKEND_CONFIG = {
  provider: 'remote_backend',
  explainUrl: 'https://subtitle-learning-backend-960679778367.europe-west1.run.app'
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== MESSAGE_TYPES.REQUEST_WORD_EXPLANATION) {
    return false
  }

  handleWordExplanationRequest(message.request)
    .then(data => {
      sendResponse(createSuccessResponse(data))
    })
    .catch(error => {
      sendResponse(createErrorResponse(error))
    })

  return true
})

async function handleWordExplanationRequest(request) {
  const normalizedRequest = normalizeExplanationRequest(request)
  await delay(MOCK_EXPLANATION_DELAY_MS)

  return requestExplanationFromConfiguredProvider(normalizedRequest)
}

async function requestExplanationFromConfiguredProvider(request) {
  if (BACKEND_CONFIG.provider === 'remote_backend') {
    return requestExplanationFromRemoteBackend(request)
  }

  return getMockExplanationFromBackground(request)
}

async function getMockExplanationFromBackground(request) {
  // API keys must never be stored in, bundled with, or called directly from the extension.
  return {
    word: request.word,
    phrase: request.phrase,
    sentence: request.sentence,
    bestPhrase: request.phrase || request.word,
    isPhrase: Boolean(request.phrase),
    confidence: request.phrase ? 0.45 : 0,
    phraseConfidence: request.phrase ? 0.45 : 0,
    dictionaryMeaning: `Background mock dictionary meaning for "${request.word}"`,
    contextualMeaning: `Background mock contextual meaning for "${request.word}" in this caption.`,
    sentenceTranslation: `Background mock translation of: ${request.sentence}`,
    usageNote: `Mock response from background. ${request.subtitleLanguageDetected} -> ${request.nativeLanguage}`,
    partOfSpeech: 'mock',
    difficultyLevel: 'easy',
    familiarityHint: `Mock mode: ${request.explanationMode}, level: ${request.learnerLevel}`,
    exampleUsage: `Mock example sentence with "${request.word}".`,
    register: 'neutral',
    nuanceNote: 'Mock nuance note from the background layer.',
    commonMistake: '',
    collocations: [],
    learnerLevelUsed: request.learnerLevel,
    subtitleLanguageDetected: request.subtitleLanguageDetected,
    source: 'background_mock'
  }
}

async function requestExplanationFromRemoteBackend(request) {
  // API keys must never be stored in, bundled with, or called directly from the extension.
  const betaAccessCode = await getBetaAccessCode()
  const explainUrl = await getBackendExplainUrl()

  if (!betaAccessCode) {
    throw createContractError('BETA_ACCESS_REQUIRED', 'Beta access code required. Open the extension settings and enter your beta code.')
  }

  let response

  try {
    response = await fetch(explainUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${betaAccessCode}`
      },
      body: JSON.stringify(request)
    })
  } catch (error) {
    throw createContractError('BACKEND_NETWORK_ERROR', error?.message || 'Backend request failed.')
  }

  let payload

  try {
    payload = await response.json()
  } catch {
    throw createContractError('BACKEND_INVALID_JSON', 'Backend returned invalid JSON.')
  }

  if (!response.ok || payload?.ok === false) {
    throw createContractError(
      payload?.error?.code || 'BACKEND_ERROR',
      payload?.error?.message || `Backend request failed with HTTP ${response.status}.`
    )
  }

  if (payload?.ok !== true || !payload.data || typeof payload.data !== 'object') {
    throw createContractError('BACKEND_INVALID_RESPONSE', 'Backend returned an invalid response contract.')
  }

  return payload.data
}

async function getBackendExplainUrl() {
  const storedUrl = await getStorageValue(BACKEND_URL_STORAGE_KEY, '')
  const configuredUrl = String(storedUrl || BACKEND_CONFIG.explainUrl || '').trim()

  return buildExplainEndpointUrl(configuredUrl)
}

function buildExplainEndpointUrl(value) {
  try {
    const url = new URL(value)
    const pathname = url.pathname.replace(/\/+$/, '')

    if (!pathname || pathname === '') {
      url.pathname = '/explain'
    } else if (pathname !== '/explain' && !pathname.endsWith('/explain')) {
      url.pathname = `${pathname}/explain`
    } else {
      url.pathname = pathname
    }

    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    const fallbackUrl = BACKEND_CONFIG.explainUrl.endsWith('/explain')
      ? BACKEND_CONFIG.explainUrl
      : `${BACKEND_CONFIG.explainUrl.replace(/\/+$/, '')}/explain`

    return fallbackUrl
  }
}

async function getBetaAccessCode() {
  const value = await getStorageValue(BETA_ACCESS_STORAGE_KEY, '')
  return String(value || '').trim()
}

function normalizeExplanationRequest(request) {
  if (!request || typeof request !== 'object') {
    throw createContractError('INVALID_REQUEST', 'Invalid explanation request.')
  }

  const word = String(request.word || '').trim()
  const phrase = String(request.phrase || '').trim()
  const sentence = String(request.sentence || '').trim()
  const nativeLanguage = String(request.nativeLanguage || request.explanationLanguage || request.learnerLanguage || 'tr').trim()
  const targetLanguage = String(request.targetLanguage || getLegacyTargetLanguage(request.subtitleLanguage) || 'en').trim()
  const subtitleLanguageDetected = String(
    request.subtitleLanguageDetected ||
    request.subtitleLanguage ||
    request.targetLanguage ||
    'auto'
  ).trim()
  const explanationMode = String(request.explanationMode || 'deep').trim() === 'quick' ? 'quick' : 'deep'
  const learnerLevel = normalizeLearnerLevel(request.learnerLevel)
  const videoContext = normalizeVideoContext(request.videoContext)
  const subtitleContext = normalizeSubtitleContext(request.subtitleContext, sentence)

  if (!word) {
    throw createContractError('MISSING_WORD', 'Missing selected word.')
  }

  if (!sentence) {
    throw createContractError('MISSING_SENTENCE', 'Missing caption sentence.')
  }

  return {
    word,
    phrase,
    sentence,
    nativeLanguage,
    targetLanguage,
    subtitleLanguageDetected,
    explanationMode,
    learnerLevel,
    subtitleContext,
    videoContext
  }
}

function getLegacyTargetLanguage(subtitleLanguage) {
  const value = String(subtitleLanguage || '').trim()
  return value && value !== 'auto' ? value : ''
}

function normalizeVideoContext(videoContext) {
  if (!videoContext || typeof videoContext !== 'object') {
    return {
      url: '',
      timestamp: null
    }
  }

  const timestamp = Number(videoContext.timestamp)

  return {
    url: String(videoContext.url || ''),
    videoUrl: String(videoContext.videoUrl || ''),
    videoTitle: String(videoContext.videoTitle || ''),
    videoId: String(videoContext.videoId || ''),
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    timestampSeconds: Number.isFinite(Number(videoContext.timestampSeconds))
      ? Number(videoContext.timestampSeconds)
      : Number.isFinite(timestamp) ? timestamp : null,
    timestampLabel: String(videoContext.timestampLabel || '')
  }
}

function normalizeSubtitleContext(subtitleContext, fallbackSentence) {
  if (!subtitleContext || typeof subtitleContext !== 'object') {
    return {
      previousLines: [],
      currentLine: String(fallbackSentence || '').trim(),
      nextLines: []
    }
  }

  return {
    previousLines: normalizeContextLines(subtitleContext.previousLines, 2),
    currentLine: String(subtitleContext.currentLine || fallbackSentence || '').trim().slice(0, 1000),
    nextLines: normalizeContextLines(subtitleContext.nextLines, 1)
  }
}

function normalizeContextLines(value, maxItems) {
  if (!Array.isArray(value)) return []

  return value
    .map(item => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

function normalizeLearnerLevel(value) {
  const level = String(value || '').trim().toUpperCase()
  return ['A2', 'B1', 'B2', 'C1'].includes(level) ? level : 'B1'
}

function getStorageValue(key, fallbackValue) {
  return new Promise(resolve => {
    if (!chrome.storage?.local) {
      resolve(fallbackValue)
      return
    }

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

function createSuccessResponse(data) {
  return {
    ok: true,
    data
  }
}

function createErrorResponse(error) {
  const normalizedError = normalizeError(error)

  return {
    ok: false,
    error: normalizedError
  }
}

function createContractError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeError(error) {
  return {
    code: String(error?.code || 'BACKGROUND_ERROR'),
    message: String(error?.message || 'Background explanation request failed.')
  }
}

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}
