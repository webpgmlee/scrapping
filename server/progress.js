export const scrapeProgress = {
  siteId: '',
  status: 'idle',
  logs: [],
  errors: [],
  rows: [],
  error: '',
}

export function snapshotProgress() {
  return {
    siteId: scrapeProgress.siteId,
    status: scrapeProgress.status,
    logs: [...(scrapeProgress.logs || [])],
    errors: [...(scrapeProgress.errors || [])],
    rows: scrapeProgress.rows || [],
    error: scrapeProgress.error || '',
  }
}

export function setProgressSite(siteId) {
  scrapeProgress.siteId = siteId
  scrapeProgress.status = 'running'
  scrapeProgress.rows = []
  scrapeProgress.logs = []
  scrapeProgress.errors = []
  scrapeProgress.error = ''
}

export function attachProgress(logs, errors) {
  scrapeProgress.status = 'running'
  scrapeProgress.logs = logs
  scrapeProgress.errors = errors
}

export function setProgressRows(rows) {
  scrapeProgress.rows = rows || []
}

export function finishProgress(status = 'done', error = '') {
  scrapeProgress.status = status
  if (error) scrapeProgress.error = error
}
