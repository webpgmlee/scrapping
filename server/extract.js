export function extractFromDocument() {
  const uniqueHeaders = (headers) => {
    const seen = new Map()
    return headers.map((header, index) => {
      const base = header || `컬럼${index + 1}`
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      return count === 0 ? base : `${base}_${count + 1}`
    })
  }

  const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim()
  const isVisible = (el) => {
    if (!el) return false
    if (el.checkVisibility) return el.checkVisibility()
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0
  }

  const toRecords = (headers, matrix, name) => {
    const unique = uniqueHeaders(headers)
    const rows = matrix
      .filter((cells) => cells.some((cell) => cell))
      .map((cells) => {
        const record = {}
        unique.forEach((header, index) => {
          record[header] = cells[index] ?? ''
        })
        return record
      })
    if (!unique.length || !rows.length) return null
    if (unique.includes('일요일') && unique.includes('월요일')) return null
    return { name, headers: unique, rows }
  }

  const tables = []
  const seen = new Set()

  const visitRoot = (root) => {
    root.querySelectorAll('table').forEach((table) => {
      if (table.querySelector('table')) return
      if (seen.has(table) || !isVisible(table)) return
      seen.add(table)

      const headerCells = table.querySelectorAll('thead th, thead td')
      let headers = [...headerCells].map((cell) => normalize(cell.innerText))
      const bodyRows = [...table.querySelectorAll('tbody tr')]
      const allRows = bodyRows.length ? bodyRows : [...table.querySelectorAll('tr')]
      if (!headers.length && allRows.length) {
        headers = [...allRows[0].querySelectorAll('th, td')].map((cell) => normalize(cell.innerText))
      }
      const dataRows = headers.length && table.querySelector('thead') ? allRows : allRows.slice(1)
      const matrix = dataRows.map((row) =>
        [...row.querySelectorAll('th, td')].map((cell) => normalize(cell.innerText)),
      )
      const extracted = toRecords(headers, matrix, table.caption?.innerText?.trim() || `표 ${tables.length + 1}`)
      if (extracted) tables.push(extracted)
    })

    root.querySelectorAll('[role="grid"], [role="table"]').forEach((grid, index) => {
      if (seen.has(grid) || !isVisible(grid) || grid.querySelector('table')) return
      seen.add(grid)
      const headers = [...grid.querySelectorAll('[role="columnheader"]')].map((cell) => normalize(cell.innerText))
      const matrix = [...grid.querySelectorAll('[role="row"]')]
        .map((row) => [...row.querySelectorAll('[role="gridcell"], [role="cell"]')].map((cell) => normalize(cell.innerText)))
        .filter((cells) => cells.length)
      const extracted = toRecords(headers, matrix, `그리드 ${index + 1}`)
      if (extracted) tables.push(extracted)
    })

    root.querySelectorAll('.ag-root, .ag-root-wrapper').forEach((grid, index) => {
      if (seen.has(grid) || !isVisible(grid)) return
      seen.add(grid)
      const headers = [...grid.querySelectorAll('.ag-header-cell-text, .ag-header-cell-label')].map((cell) =>
        normalize(cell.innerText),
      )
      const matrix = [...grid.querySelectorAll('.ag-center-cols-container .ag-row')].map((row) =>
        [...row.querySelectorAll('.ag-cell')].map((cell) => normalize(cell.innerText)),
      )
      const extracted = toRecords(headers, matrix, `AG Grid ${index + 1}`)
      if (extracted) tables.push(extracted)
    })

    root.querySelectorAll('.MuiDataGrid-root').forEach((grid, index) => {
      if (seen.has(grid) || !isVisible(grid)) return
      seen.add(grid)
      const headers = [...grid.querySelectorAll('.MuiDataGrid-columnHeaderTitle')].map((cell) => normalize(cell.innerText))
      const matrix = [...grid.querySelectorAll('.MuiDataGrid-row')].map((row) =>
        [...row.querySelectorAll('.MuiDataGrid-cell')].map((cell) => normalize(cell.innerText)),
      )
      const extracted = toRecords(headers, matrix, `DataGrid ${index + 1}`)
      if (extracted) tables.push(extracted)
    })

    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) visitRoot(el.shadowRoot)
    })
  }

  visitRoot(document)

  if (!tables.length) {
    const pairs = []
    document.querySelectorAll('dl').forEach((list) => {
      const titles = [...list.querySelectorAll('dt')]
      const values = [...list.querySelectorAll('dd')]
      titles.forEach((title, index) => {
        const key = normalize(title.innerText)
        const value = normalize(values[index]?.innerText)
        if (key) pairs.push({ 항목: key, 값: value })
      })
    })
    if (pairs.length) {
      tables.push({ name: '항목 목록', headers: ['항목', '값'], rows: pairs })
    }
  }

  return tables
}

export function extractPairsFromDocument() {
  const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim()
  const pairs = {}
  const leakedLabel = /^(No|재입찰번호|입찰공고번호|공고명|수요기관|공고기관|진행상황|업무구분|참조번호|계약방법|구분|단계구분)$/
  const placeholder = /^[.·…]{2,}$/
  const isVisible = (el) => {
    if (!el) return false
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width + box.height > 0
  }
  const setPair = (key, value) => {
    const k = normalize(key).replace(/[()]/g, '')
    const v = normalize(value)
    if (!k || !v || k === v || k.length > 40 || v.length > 400) return
    if (leakedLabel.test(v) || placeholder.test(v)) return
    if (!pairs[k]) pairs[k] = v
  }

  const controlValue = (el) => {
    const control = el.querySelector?.('input, textarea, select') || (el.matches?.('input, textarea, select') ? el : null)
    return normalize(control?.value || el.innerText || '')
  }

  const frame = document.querySelector('#mf_wfm_container_mainWframe')
  const frameBox = frame?.getBoundingClientRect()
  const root = frame && frameBox && frameBox.width + frameBox.height > 0
    ? frame
    : document.querySelector('#mf_wfm_container, #contents, main, .contents') || document
  root.querySelectorAll('[data-title]').forEach((el) => {
    if (!isVisible(el)) return
    setPair(el.getAttribute('data-title'), controlValue(el))
  })
  root.querySelectorAll('input[title], textarea[title], select[title]').forEach((el) => {
    if (!isVisible(el)) return
    setPair(el.getAttribute('title'), el.value)
  })
  root.querySelectorAll('tr').forEach((row) => {
    if (!isVisible(row)) return
    const cells = [...row.children].filter((el) => el.tagName === 'TH' || el.tagName === 'TD')
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]
      const next = cells[index + 1]
      if (!isVisible(cell)) continue
      if (cell.tagName === 'TD') {
        const titled = normalize(cell.getAttribute('data-title') || '')
        if (titled) setPair(titled, cell.innerText)
      }
      if (next?.tagName === 'TD' && isVisible(next) && (cell.tagName === 'TH' || cell.getAttribute('scope') === 'row')) {
        setPair(cell.innerText, next.innerText)
      }
    }
  })

  root.querySelectorAll('dt').forEach((dt) => {
    if (!isVisible(dt)) return
    const dd = dt.nextElementSibling
    if (dd?.tagName === 'DD' && isVisible(dd)) setPair(dt.innerText, dd.innerText)
  })

  return pairs
}

export function extractG2bNoticeFields() {
  const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim()
  const isDate = (text) => /^\d{4}[./-]\d{2}[./-]\d{2}/.test(text)
  const isAmount = (text) => /[0-9]{1,3}(?:,[0-9]{3})+/.test(text)
  const pairs = {}
  const setPair = (key, value) => {
    const k = normalize(key)
    const v = normalize(value).replace(/원$/g, '').trim()
    if (!k || !v || v === '-' || v === '자료없음') return
    if (!pairs[k]) pairs[k] = v
  }

  const frame = document.querySelector('#mf_wfm_container_mainWframe')
  const frameBox = frame?.getBoundingClientRect()
  const root = frame && frameBox && frameBox.width + frameBox.height > 0
    ? frame
    : document.querySelector('#mf_wfm_container') || document

  root.querySelectorAll('[data-title]').forEach((el) => {
    const box = el.getBoundingClientRect()
    if (box.width + box.height === 0) return
    const control = el.querySelector('input, textarea, select')
    setPair(el.getAttribute('data-title'), control?.value || el.innerText)
  })
  root.querySelectorAll('input[title], textarea[title]').forEach((el) => {
    const box = el.getBoundingClientRect()
    if (box.width + box.height === 0) return
    setPair(el.getAttribute('title'), el.value)
  })

  const tables = [...root.querySelectorAll('table')]
  const progress = tables.find((table) => /진행명/.test(table.innerText) && /시작일시/.test(table.innerText))
  if (progress) {
    ;[...progress.querySelectorAll('tr')].slice(1).forEach((row) => {
      const cells = [...row.querySelectorAll('th, td')].map((cell) => normalize(cell.innerText))
      const name = cells.find((cell) => /공고게시|입찰서제출|입찰서 제출|개찰/.test(cell)) || ''
      const dates = cells.filter((cell) => isDate(cell))
      if (/입찰서제출|입찰서 제출/.test(name)) {
        setPair('입찰개시일', dates[0])
        setPair('입찰마감일시', dates[1] || dates[0])
      }
      if (name === '공고게시') {
        setPair('게시일시', dates[0])
        setPair('공고일자', dates[0])
      }
    })
  }

  const baseGrid = root.querySelector('#mf_wfm_container_mainWframe_gridView5, [id$="gridView5"]')
  const baseText = normalize(baseGrid?.innerText || '')
  if (baseGrid && !/자료없음/.test(baseText)) {
    const amount = (baseText.match(/[0-9]{1,3}(?:,[0-9]{3})+/g) || [])[0]
    if (amount) setPair('기초금액', amount)
  }

  const base = tables.find((table) => /기초금액/.test(table.innerText) && /입찰분류/.test(table.innerText))
  if (base && !/자료없음/.test(base.innerText)) {
    ;[...base.querySelectorAll('tr')].slice(1).forEach((row) => {
      const amount = [...row.querySelectorAll('td')].map((cell) => normalize(cell.querySelector('input')?.value || cell.innerText)).find((cell) => isAmount(cell))
      if (amount) setPair('기초금액', amount)
    })
  }

  const regionTh = [...root.querySelectorAll('th')].find((el) => normalize(el.innerText) === '지역제한')
  if (regionTh) {
    const row = regionTh.parentElement
    const children = [...(row?.children || [])]
    const next = children[children.indexOf(regionTh) + 1]
    setPair('지역제한', next?.innerText || '')
  }

  const orgTable = tables.find((table) => /수요기관/.test(table.innerText) && /부서명/.test(table.innerText))
  if (orgTable) {
    const headers = [...(orgTable.querySelector('tr')?.querySelectorAll('th, td') || [])].map((cell) => normalize(cell.innerText))
    const values = [...(orgTable.querySelectorAll('tr')[1]?.querySelectorAll('th, td') || [])].map((cell) => normalize(cell.innerText))
    headers.forEach((header, index) => setPair(header, values[index]))
  }

  return pairs
}

export function extractG2bReservePrices() {
  const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim()
  const pairs = {}
  const root = document.querySelector('#mf_wfm_container_RsvePrceCmpuRsltPL') || document
  root.querySelectorAll('input[title], input[data-title], textarea[title]').forEach((el) => {
    const key = normalize(el.getAttribute('title') || el.getAttribute('data-title') || '')
    const value = normalize(el.value).replace(/원$/g, '')
    if (/^(예정가격|기초금액)$/.test(key) && /[0-9]/.test(value)) pairs[key] = value
  })
  return pairs
}

export function extractG2bBidderRows() {
  const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim()
  const grid = [...document.querySelectorAll('#mf_wfm_container [id^="mf_wfm_container_grd"]')]
    .find((el) => /업체명/.test(el.innerText || '') && /투찰|입찰금액/.test(el.innerText || ''))
  if (!grid) return []

  const headers = []
  const seen = new Set()
  ;[...grid.querySelectorAll('th, .gridHeaderTDDefault')].forEach((el) => {
    const text = normalize(el.innerText)
    if (!text || /^Grid/.test(text) || seen.has(text)) return
    seen.add(text)
    headers.push(text)
  })

  const rowsByIndex = {}
  grid.querySelectorAll('td[id*="_cell_"]').forEach((td) => {
    const match = td.id.match(/_cell_(\d+)_(\d+)$/)
    if (!match) return
    const row = Number(match[1])
    const col = Number(match[2])
    const value = normalize(td.querySelector('input')?.value || td.innerText)
    if (!value) return
    rowsByIndex[row] = rowsByIndex[row] || {}
    rowsByIndex[row][col] = value
  })

  return Object.keys(rowsByIndex)
    .sort((left, right) => Number(left) - Number(right))
    .map((rowIndex) => {
      const record = {}
      headers.forEach((header, index) => {
        record[header] = rowsByIndex[rowIndex][index] || ''
      })
      return record
    })
    .filter((row) => Object.values(row).some(Boolean))
}
