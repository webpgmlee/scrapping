import { useEffect, useMemo, useRef, useState } from 'react'
import { downloadXlsx } from './utils/download'
import './App.css'

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForScrape(siteId, onProgress) {
  let misses = 0
  for (;;) {
    try {
      const response = await fetch('/api/scrape/progress')
      if (!response.ok) throw new Error('progress')
      const progress = await response.json()
      misses = 0
      if (progress.siteId && progress.siteId !== siteId) {
        await delay(2000)
        continue
      }
      onProgress(progress)
      if (progress.status === 'done' || progress.status === 'error') return progress
    } catch {
      misses += 1
      if (misses >= 15) throw new Error('Failed to fetch')
    }
    await delay(2000)
  }
}

function App() {
  const [sites, setSites] = useState([])
  const [columns, setColumns] = useState([])
  const [results, setResults] = useState({})
  const watchingRef = useRef('')

  useEffect(() => {
    fetch('/api/sites')
      .then((response) => response.json())
      .then((data) => {
        setSites(data.sites || [])
        setColumns(data.columns || [])
      })
      .catch(() => {
        setSites([])
      })
  }, [])

  const mergedRows = useMemo(
    () => sites.flatMap((site) => results[site.id]?.rows || []),
    [sites, results],
  )

  function mergeRowsForSite(current, siteId, rows) {
    return sites.flatMap((item) => (item.id === siteId ? rows : current[item.id]?.rows || []))
  }

  function saveAndDownload(siteId, payload) {
    const rows = payload.rows || []
    setResults((current) => ({
      ...current,
      [siteId]: {
        status: 'done',
        rows,
        logs: payload.logs || current[siteId]?.logs || [],
        errors: payload.errors || [],
      },
    }))
    const merged = mergeRowsForSite(results, siteId, rows)
    if (merged.length) downloadXlsx(merged, columns, '입찰집계')
  }

  function applyProgress(siteId, progress) {
    setResults((current) => ({
      ...current,
      [siteId]: {
        ...(current[siteId] || {}),
        status: 'loading',
        rows: progress.rows?.length ? progress.rows : current[siteId]?.rows || [],
        logs: progress.logs?.length ? progress.logs : current[siteId]?.logs || [],
        errors: progress.errors || [],
      },
    }))
  }

  async function watchScrape(site, startRequest) {
    if (watchingRef.current === site.id) return
    watchingRef.current = site.id
    setResults((current) => ({
      ...current,
      [site.id]: {
        status: 'loading',
        rows: current[site.id]?.rows || [],
        logs: current[site.id]?.logs?.length ? current[site.id].logs : [`${site.name} 조회를 시작합니다.`],
        errors: [],
      },
    }))

    try {
      if (startRequest) {
        const response = await fetch(`/api/scrape/${site.id}`, { method: 'POST' })
        const data = await response.json().catch(() => ({}))
        if (response.status !== 409 && !response.ok) {
          throw new Error(data.error || '조회에 실패했습니다.')
        }
      }

      const progress = await waitForScrape(site.id, (next) => applyProgress(site.id, next))
      if (progress.status === 'error') {
        throw new Error(progress.error || progress.errors?.[0] || '조회에 실패했습니다.')
      }
      saveAndDownload(site.id, progress)
    } catch (error) {
      let recovered = null
      try {
        const progress = await fetch('/api/scrape/progress').then((res) => res.json())
        if (progress.siteId === site.id && progress.status === 'done') recovered = progress
      } catch {
        recovered = null
      }

      if (recovered) {
        saveAndDownload(site.id, recovered)
        return
      }

      const message =
        error.message === 'Failed to fetch'
          ? '서버 연결이 끊겼습니다. 개발 서버를 다시 켠 뒤 조회해 주세요.'
          : error.message
      setResults((current) => ({
        ...current,
        [site.id]: {
          status: 'error',
          rows: current[site.id]?.rows || [],
          logs: current[site.id]?.logs || [],
          errors: [message],
        },
      }))
    } finally {
      if (watchingRef.current === site.id) watchingRef.current = ''
    }
  }

  useEffect(() => {
    if (!sites.length) return
    let cancelled = false
    fetch('/api/scrape/progress')
      .then((response) => response.json())
      .then((progress) => {
        if (cancelled || progress.status !== 'running' || !progress.siteId) return
        const site = sites.find((item) => item.id === progress.siteId)
        if (site) watchScrape(site, false)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sites])

  function scrapeSite(site) {
    watchScrape(site, true)
  }

  function handleDownload() {
    if (!mergedRows.length) return
    downloadXlsx(mergedRows, columns, '입찰집계')
  }

  return (
    <div className="app">
      <header className="hero-panel">
        <p className="eyebrow">Bid result aggregator</p>
        <h1>입찰 결과 집계</h1>
        <p className="lede">
          나라장터, 토지주택공사, 국방부, 도로공사에서 각각 조회한 뒤, 같은 양식으로 모아
          xlsx로 내려받습니다. 필성건설이 참여한 건은 당사 투찰율·사정율·순위가 채워집니다.
        </p>
      </header>

      <section className="site-grid">
        {sites.map((site) => {
          const result = results[site.id]
          return (
            <article key={site.id} className="card site-card">
              <div>
                <h2>{site.name}</h2>
                <p className="site-url">{site.url}</p>
                <p className="hint">{site.menuPath}</p>
              </div>
              <button
                type="button"
                disabled={result?.status === 'loading'}
                onClick={() => scrapeSite(site)}
              >
                {result?.status === 'loading' ? '조회 중...' : site.buttonLabel}
              </button>
              <p className={`status ${result?.status || 'idle'}`}>
                {result?.status === 'done'
                  ? `${result.rows.length}건 수집`
                  : result?.status === 'error'
                    ? '조회 실패'
                    : result?.status === 'loading'
                      ? '페이지 이동 및 상세 수집 중'
                      : '대기'}
              </p>
              {result?.errors?.length ? (
                <ul className="alert-list">
                  {result.errors.slice(0, 5).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          )
        })}
      </section>

      <section className="card history-card">
        <h2>수집 내역</h2>
        {sites.some((site) => results[site.id]?.logs?.length) ? (
          <div className="history-list">
            {sites.map((site) => {
              const result = results[site.id]
              if (!result?.logs?.length) return null
              return (
                <div key={site.id} className="history-group">
                  <h3>{site.name}</h3>
                  <ul className="logs">
                    {result.logs.map((log, index) => (
                      <li key={`${site.id}-${index}`}>{log}</li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="hint">조회를 시작하면 진행 로그가 여기에 표시됩니다.</p>
        )}
      </section>

      <section className="card result-card">
        <div className="result-meta">
          <div>
            <h2>집계 결과</h2>
            <p>사이트별로 조회한 데이터를 아래 표에 합칩니다. 현재 {mergedRows.length}건입니다.</p>
          </div>
          <button type="button" className="secondary" disabled={!mergedRows.length} onClick={handleDownload}>
            합친 데이터 xlsx 다운로드
          </button>
        </div>

        {mergedRows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mergedRows.slice(0, 80).map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column}>{row[column]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">아직 조회된 데이터가 없습니다. 사이트별 조회시작 버튼을 눌러 주세요.</p>
        )}
        {mergedRows.length > 80 ? (
          <p className="hint">미리보기는 80행까지 표시합니다. 다운로드에는 전체가 포함됩니다.</p>
        ) : null}
      </section>
    </div>
  )
}

export default App
