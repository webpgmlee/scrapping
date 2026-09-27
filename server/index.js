import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { finishProgress, scrapeProgress, setProgressSite, setProgressRows, snapshotProgress } from './progress.js'
import { listSites, scrapeById } from './sites.js'
import { OUTPUT_COLUMNS } from './schema.js'

const app = express()
const PORT = 3001
const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dirname, '../public')))

app.get('/api/sites', (_req, res) => {
  res.json({ sites: listSites(), columns: OUTPUT_COLUMNS, scraping: true })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/scrape/progress', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(snapshotProgress())
})

app.post('/api/scrape/:id', (req, res) => {
  if (scrapeProgress.status === 'running') {
    res.status(409).json({
      error: '이미 조회가 진행 중입니다.',
      siteId: scrapeProgress.siteId,
    })
    return
  }

  const siteId = req.params.id
  setProgressSite(siteId)
  res.json({ started: true, siteId })

  scrapeById(siteId)
    .then((result) => {
      setProgressRows(result.rows || [])
      scrapeProgress.logs = result.logs || scrapeProgress.logs
      scrapeProgress.errors = result.errors || []
      finishProgress('done')
    })
    .catch((error) => {
      console.error(error)
      scrapeProgress.logs = error.logs ?? scrapeProgress.logs
      scrapeProgress.errors = error.errors ?? scrapeProgress.errors
      finishProgress('error', error.message || '스크래핑 중 오류가 발생했습니다.')
    })
})

const server = app.listen(PORT, () => {
  console.log(`스크래핑 서버 실행: http://localhost:${PORT}`)
})
server.timeout = 0
server.requestTimeout = 0
server.keepAliveTimeout = 65 * 1000
server.headersTimeout = 70 * 1000
