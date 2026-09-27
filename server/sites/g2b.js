import { attachProgress, finishProgress, setProgressRows } from '../progress.js'
import { clickGaechalComplete, clickSearch, closePopups, delay, fillByLabel, followMenuPath, goNextPage, isBidListFormVisible, launchBrowser, mapPool, readGaechalListRows, returnToGaechalList, waitForGaechalDetail, waitForGaechalList, waitIdle, waitForReady } from '../browser.js'
import { extractFromDocument, extractG2bBidderRows, extractG2bNoticeFields, extractG2bReservePrices, extractPairsFromDocument } from '../extract.js'
import { buildResultRow, parseBidders, pickValue } from '../schema.js'

const MAX_PAGES = 8
const INDUSTRY_CODES = ['6202', '4946', '0040']
const DETAIL_WORKERS = 4

const INDUSTRY_POPUP = '#mf_wfm_container_tacBidPbancLst_contents_tab2_body_intpSearchPopup'
const INDUSTRY_CODE_INPUT = '#mf_wfm_container_tacBidPbancLst_contents_tab2_body_intpSearchPopup_wframe_popupCnts_sbxIntpCd'
const INDUSTRY_POPUP_SEARCH = '#mf_wfm_container_tacBidPbancLst_contents_tab2_body_intpSearchPopup_wframe_popupCnts_btnS0001'
const INDUSTRY_SEARCH_BUTTON = '#mf_wfm_container_tacBidPbancLst_contents_tab2_body_btnWholIntp2'

function bidderTable(tables) {
  return tables.find((table) => /순위|업체명|투찰|입찰금액|상호/.test(table.headers.join(' ')))
}

function g2bRegion(detail) {
  const limit = pickValue(detail, ['지역제한'])
  if (!limit || /해당없음|제한없음|무제한/.test(limit)) {
    return pickValue(detail, ['참가가능지역', '참가지역1', '참가지역']) || '-'
  }
  if (limit === '제한' || /제한/.test(limit)) {
    return pickValue(detail, ['참가가능지역', '참가지역1', '참가지역']) || limit
  }
  return pickValue(detail, ['참가가능지역']) || '-'
}

function noticeNumber(listRow) {
  return pickValue(listRow, ['입찰공고번호']).replace(/-\d+$/, '').slice(0, 13)
}

async function clickG2bSearch(page, logs) {
  const button = page.locator('#mf_wfm_container_tacBidPbancLst_contents_tab2_body_btnS0004, #mf_wfm_container_tacBidPbancLst_contents_tab2_body_btnS0005').filter({ visible: true }).first()
  await button.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  if ((await button.count().catch(() => 0)) > 0) {
    await button.click({ force: true }).catch(() => {})
    logs.push('검색 버튼 클릭')
    await waitIdle(page)
    await delay(250)
    return true
  }
  return clickSearch(page, logs)
}

async function noticeDetailText(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#mf_wfm_container_mainWframe') || document.querySelector('#mf_wfm_container')
    if (!root) return ''
    const values = [...root.querySelectorAll('input, textarea')].map((el) => el.value || '').join(' ')
    return `${root.innerText || ''} ${values}`
  }).catch(() => '')
}

async function isG2bNoticeDetail(page, number, name) {
  const back = await page.locator('#mf_wfm_container_btnBackList').isVisible().catch(() => false)
  if (!back) return false
  const text = await noticeDetailText(page)
  if (number && text.includes(number)) return true
  if (name && name.length >= 6 && text.includes(name.slice(0, 10))) return true
  return !(await isBidListFormVisible(page))
}

async function waitForNoticeGrid(page, number, timeout = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const found = await page.evaluate((number) => {
      const grid = document.querySelector('#mf_wfm_container_tacBidPbancLst_contents_tab2_body_gridView1')
      if (!grid) return false
      const text = grid.innerText || ''
      if (number && text.includes(number)) return true
      return [...grid.querySelectorAll('td[id*="gridView1_cell_"] a')].some((el) => (el.innerText || '').trim().length > 4)
    }, number).catch(() => false)
    if (found) return true
    await delay(300)
  }
  return false
}

async function clickNoticeNameCell(page, number, name) {
  return page.evaluate(({ number, name }) => {
    const visible = (el) => {
      if (!el) return false
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width + box.height > 0
    }
    const grid = document.querySelector('#mf_wfm_container_tacBidPbancLst_contents_tab2_body_gridView1')
    if (!grid) return false
    const cells = [...grid.querySelectorAll('td[id*="gridView1_cell_"]')]
    const numberCell = number
      ? cells.find((el) => (el.innerText || '').includes(number))
      : null
    let nameCell = null
    if (numberCell?.id) {
      const match = numberCell.id.match(/^(.*_cell_)(\d+)_\d+$/)
      if (match) {
        const rowPrefix = `${match[1]}${match[2]}_`
        nameCell = cells.find((el) => el.id.startsWith(rowPrefix) && el.querySelector('a'))
      }
    }
    if (!nameCell && name) {
      nameCell = cells.find((el) => visible(el) && el.querySelector('a') && (el.innerText || '').includes(name.slice(0, 8)))
    }
    if (!nameCell) {
      nameCell = cells.find((el) => visible(el) && el.querySelector('a') && (el.innerText || '').trim().length > 4)
        || cells.find((el) => el.querySelector('a') && (el.innerText || '').trim().length > 4)
    }
    const target = nameCell?.querySelector('a') || nameCell
    if (!target) return false
    target.scrollIntoView({ block: 'center', inline: 'nearest' })
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    return true
  }, { number, name })
}

async function clickListButton(page, logs) {
  let clicked = false
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const back = page.locator('#mf_wfm_container_btnBackList').filter({ visible: true }).first()
    if ((await back.count().catch(() => 0)) === 0) break
    await back.evaluate((el) => el.click()).catch(() => back.click({ force: true }))
    clicked = true
    await waitIdle(page)
    await delay(200)
  }
  if (clicked) logs.push('목록으로 돌아가기')
  const search = page.locator('#mf_wfm_container_tacBidPbancLst_contents_tab2_body_btnS0004, #mf_wfm_container_tacBidPbancLst_contents_tab2_body_btnS0005').filter({ visible: true }).first()
  await search.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  await delay(150)
  return (await search.count().catch(() => 0)) > 0
}

async function resetG2bSearch(page, searchType = '입찰공고') {
  const selector = searchType === '개찰결과'
    ? '#mf_wfm_container_tacBidPbancLst_contents_tab2_body_btnReset2'
    : '#mf_wfm_container_tacBidPbancLst_contents_tab2_body_btnReset1'
  const reset = page.locator(selector).filter({ visible: true }).first()
  if ((await reset.count().catch(() => 0)) === 0) return
  await reset.click({ force: true }).catch(() => {})
  await waitIdle(page)
  await delay(200)
}

async function recoverG2bList(page, logs, searchType = '개찰결과') {
  if (!(await isBidListFormVisible(page))) {
    const restored = await returnToGaechalList(page, null, logs)
    if (!restored && !(await isBidListFormVisible(page))) {
      logs.push('입찰공고목록 메뉴로 다시 이동합니다.')
      await followMenuPath(page, ['입찰', '입찰공고', '입찰공고목록'], logs)
      await waitIdle(page)
      await delay(250)
    }
  }
  const visible = await isBidListFormVisible(page)
  if (visible) await selectG2bSearchType(page, searchType, logs)
  await delay(200)
  return visible || (await isBidListFormVisible(page))
}

async function fillNoticeNumber(page, number, searchType = '입찰공고') {
  const selector = searchType === '개찰결과'
    ? '#mf_wfm_container_tacBidPbancLst_contents_tab2_body_ibxBidPbancNo2'
    : '#mf_wfm_container_tacBidPbancLst_contents_tab2_body_ibxBidPbancNo'
  await page.locator(selector).first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => {})
  await page.locator(selector).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})

  const filled = await page.evaluate(({ selector, number }) => {
    const visible = (el) => {
      if (!el) return false
      const style = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width + box.height > 0
    }
    const preferred = document.querySelector(selector)
    const fallbacks = [...document.querySelectorAll('input[title="입찰공고번호"]')]
    const el = (preferred && visible(preferred) ? preferred : null) || fallbacks.find(visible)
    if (!el) return false
    try {
      window.$w?.getComponentById?.(el.id)?.setValue?.(number)
    } catch {}
    el.focus()
    el.value = number
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
    return (el.value || '').includes(String(number).slice(0, 8))
  }, { selector, number })
  if (filled) return true

  const input = page.locator(selector).filter({ visible: true }).first()
  if ((await input.count().catch(() => 0)) > 0) {
    await input.click({ force: true }).catch(() => {})
    await input.fill(number, { force: true, timeout: 5000 }).catch(async () => {
      await input.evaluate((el, next) => {
        el.value = next
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }, number)
    })
    return true
  }
  return fillByLabel(page, '입찰공고번호', number)
}

async function openNoticeByName(page, listRow, logs) {
  const name = pickValue(listRow, ['공고명', '공사명'])
  const number = noticeNumber(listRow)
  const foundGrid = await waitForNoticeGrid(page, number)
  if (!foundGrid) {
    logs.push(`입찰공고 검색 결과가 없습니다: ${name || number}`)
    return false
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clicked = await clickNoticeNameCell(page, number, name)
    if (!clicked) {
      await delay(500)
      continue
    }
    logs.push(`공고명 클릭: ${name || number}`)
    await waitIdle(page)
    const openedAt = Date.now()
    while (Date.now() - openedAt < 10000) {
      if (await isG2bNoticeDetail(page, number, name)) {
        await page.locator('#mf_wfm_container_mainWframe').getByText('입찰진행정보', { exact: false }).first()
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => {})
        await delay(350)
        return true
      }
      await delay(400)
    }
  }

  logs.push(`공고명 링크를 찾지 못했습니다: ${name || number}`)
  return false
}

async function collectNoticeDetail(page, listRow, logs) {
  const number = noticeNumber(listRow)
  if (!number) {
    logs.push('입찰공고번호가 없어 2차 검색을 건너뜁니다.')
    return {}
  }

  await recoverG2bList(page, logs, '입찰공고')
  await resetG2bSearch(page)
  await selectG2bSearchType(page, '입찰공고', logs)
  let filled = await fillNoticeNumber(page, number)
  if (!filled) {
    await recoverG2bList(page, logs, '입찰공고')
    filled = await fillNoticeNumber(page, number)
  }
  logs.push(filled ? `입찰공고번호 검색: ${number}` : `입찰공고번호 입력 실패: ${number}`)
  if (!filled) return {}
  await clickG2bSearch(page, logs)
  if (!(await waitForNoticeGrid(page, number, 8000))) {
    await fillNoticeNumber(page, number)
    await clickG2bSearch(page, logs)
  }

  const opened = await openNoticeByName(page, listRow, logs)
  if (!opened) return {}

  if (!(await isG2bNoticeDetail(page, number, pickValue(listRow, ['공고명', '공사명'])))) {
    logs.push(`입찰공고 상세 불일치: ${number}`)
    await clickListButton(page, logs)
    return {}
  }

  const pairs = {
    ...(await page.evaluate(extractPairsFromDocument)),
    ...(await page.evaluate(extractG2bNoticeFields)),
  }
  await clickListButton(page, logs)
  return pairs
}

async function clickBySelector(page, selector) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector)
    if (!el) return false
    el.click()
    return true
  }, selector).catch(() => false)
}

async function fillBySelector(page, selector, value) {
  const fillIn = (scope) => scope.evaluate(({ selector, value }) => {
    const el = document.querySelector(selector)
    if (!el) return false
    try {
      window.$w?.getComponentById?.(el.id)?.setValue?.(value)
    } catch {}
    el.focus()
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return (el.value || '').includes(String(value))
  }, { selector, value }).catch(() => false)

  if (await fillIn(page)) return true
  for (const frame of page.frames()) {
    if (await fillIn(frame)) return true
  }
  return false
}

async function openG2bDetailConditions(page, logs) {
  const toggle = page.locator('#mf_wfm_container input.srch_toggle[value="상세조건"]').filter({ visible: true }).first()
  await toggle.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  if ((await toggle.count().catch(() => 0)) === 0) return false
  const className = (await toggle.getAttribute('class').catch(() => '')) || ''
  if (!/active/.test(className)) {
    await toggle.click({ force: true, timeout: 3000 }).catch(() => clickBySelector(page, '#mf_wfm_container input.srch_toggle[value="상세조건"]'))
    logs.push('검색 상세조건 열기')
    await waitIdle(page)
    await delay(250)
  }
  return true
}

async function openIndustryPopup(page, logs, code) {
  const popup = page.locator(INDUSTRY_POPUP)
  if (await popup.isVisible().catch(() => false)) return true

  const open = page.locator(INDUSTRY_SEARCH_BUTTON).filter({ visible: true }).first()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if ((await open.count().catch(() => 0)) === 0) {
      await delay(400)
      continue
    }
    await open.click({ force: true, timeout: 3000 }).catch(() => clickBySelector(page, INDUSTRY_SEARCH_BUTTON))
    await waitIdle(page)
    await popup.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
    if (await popup.isVisible().catch(() => false)) return true
    await delay(400)
  }
  logs.push(`업종 검색 팝업을 열지 못했습니다. (${code})`)
  return false
}

async function selectIndustryCode(page, code, logs) {
  try {
    await openG2bDetailConditions(page, logs)
    if (!(await openIndustryPopup(page, logs, code))) return false

    const popup = page.locator(INDUSTRY_POPUP)
    const filled = await fillBySelector(page, INDUSTRY_CODE_INPUT, code)
    if (!filled) {
      logs.push(`업종코드 입력창을 찾지 못했습니다. (${code})`)
      await clickBySelector(page, `${INDUSTRY_POPUP} input[value="닫기"]`)
      return false
    }

    await clickBySelector(page, INDUSTRY_POPUP_SEARCH)
    await waitIdle(page)
    await delay(300)

    let clicked = false
    const started = Date.now()
    while (Date.now() - started < 8000) {
      clicked = await page.evaluate(({ popup, code }) => {
        const root = document.querySelector(popup)
        const cell = [...(root?.querySelectorAll('[id*="grdIntp_cell_"]') || [])].find((el) => (el.innerText || '').trim() === code)
        if (!cell) return false
        cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
        cell.click()
        return true
      }, { popup: INDUSTRY_POPUP, code }).catch(() => false)
      if (clicked) break
      await delay(250)
    }
    if (!clicked) {
      logs.push(`업종코드 ${code}를 찾지 못했습니다.`)
      await page.locator(`${INDUSTRY_POPUP} input[value="닫기"]`).first().click({ force: true, timeout: 3000 }).catch(() => {})
      return false
    }
    await popup.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {})
    logs.push(`업종코드 선택: ${code}`)
    await delay(150)
    return true
  } catch (error) {
    logs.push(`업종코드 ${code} 선택 중 오류: ${error.message}`)
    return false
  }
}

async function goG2bNextPage(page, pageNo) {
  const nextNo = String(pageNo + 1)
  const numbered = page
    .locator('#mf_wfm_container [id*="pgl"] a, #mf_wfm_container [class*="w2pageList"] a')
    .filter({ visible: true })
    .filter({ hasText: new RegExp(`^\\s*${nextNo}\\s*$`) })
    .first()
  if ((await numbered.count().catch(() => 0)) > 0) {
    await numbered.click({ force: true }).catch(() => {})
    await waitIdle(page)
    await delay(300)
    return true
  }
  return goNextPage(page)
}

async function collectReservePrices(page, logs) {
  const view = page.locator('#mf_wfm_container_godsBtnRsvePrce, #mf_wfm_container_srvcBtnRsvePrce, #mf_wfm_container_cstnBtnRsvePrce').filter({ visible: true }).first()
  if ((await view.count().catch(() => 0)) === 0) return {}
  await view.evaluate((el) => el.click()).catch(() => view.click({ force: true }))
  await waitIdle(page)
  const popup = page.locator('#mf_wfm_container_RsvePrceCmpuRsltPL').filter({ visible: true })
  await popup.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  await delay(150)
  const pairs = await page.evaluate(extractG2bReservePrices)
  logs.push(pairs.예정가격 ? `예정가격 ${pairs.예정가격}` : '예정가격을 찾지 못했습니다.')
  if (pairs.기초금액) logs.push(`기초금액 ${pairs.기초금액}`)
  const close = page.locator('#mf_wfm_container_RsvePrceCmpuRsltPL input[value="닫기"], #mf_wfm_container_RsvePrceCmpuRsltPL [class*="w2window_close"]').filter({ visible: true }).first()
  if ((await close.count().catch(() => 0)) > 0) {
    await close.evaluate((el) => el.click()).catch(() => close.click({ force: true }))
    await waitIdle(page)
  }
  return pairs
}

async function collectGaechalDetail(page, listRow, logs) {
  const number = noticeNumber(listRow)
  const onList = await recoverG2bList(page, logs, '개찰결과')
  if (!onList) {
    logs.push(`개찰결과 검색화면 복구 실패: ${number}`)
    return { gaechalDetail: {}, bidders: [] }
  }

  await resetG2bSearch(page, '개찰결과')
  await selectG2bSearchType(page, '개찰결과', logs)
  await delay(200)
  if (number) {
    let filled = await fillNoticeNumber(page, number, '개찰결과')
    if (!filled) {
      await recoverG2bList(page, logs, '개찰결과')
      filled = await fillNoticeNumber(page, number, '개찰결과')
    }
    logs.push(filled ? `개찰결과 공고번호 검색: ${number}` : `개찰결과 공고번호 입력 실패: ${number}`)
    if (!filled) return { gaechalDetail: {}, bidders: [] }
    await clickG2bSearch(page, logs)
  }

  const found = await waitForGaechalList(page, 8000)
  if (!found) {
    logs.push(`개찰완료 목록이 없습니다: ${number}`)
    return { gaechalDetail: {}, bidders: [] }
  }

  const clicked = await clickGaechalComplete(page, 0, logs, number)
  const detailPage = clicked.popup || page
  await waitIdle(detailPage)
  const opened = await waitForGaechalDetail(page, clicked.popup)
  if (!opened) logs.push(`개찰상세 진입 확인 실패: ${number}`)
  await delay(250)
  const pairs = await detailPage.evaluate(extractPairsFromDocument)
  const detailTables = await detailPage.evaluate(extractFromDocument)
  const gridRows = await detailPage.evaluate(extractG2bBidderRows)
  const bidders = parseBidders({ rows: gridRows }).length
    ? parseBidders({ rows: gridRows })
    : parseBidders(bidderTable(detailTables))
  const reserve = await collectReservePrices(detailPage, logs)
  const restored = await returnToGaechalList(page, clicked.popup, logs)
  if (!restored) await recoverG2bList(page, logs, '개찰결과')
  return {
    gaechalDetail: { ...pairs, ...reserve },
    bidders,
  }
}

async function collectGaechalListForCode(page, logs, code) {
  const items = []
  const selected = await selectIndustryCode(page, code, logs)
  if (!selected) return items

  await clickG2bSearch(page, logs)
  const found = await waitForGaechalList(page, 8000)
  if (!found) {
    logs.push(`업종코드 ${code}: 개찰완료 공고가 없습니다.`)
    return items
  }

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    await waitForGaechalList(page, 5000)
    const rows = await readGaechalListRows(page)
    logs.push(`업종코드 ${code} ${pageNo}페이지 개찰완료 ${rows.length}건`)

    for (const listRow of rows) {
      items.push({
        listRow,
        gaechalDetail: {},
        bidders: [],
        noticeDetail: {},
      })
    }

    const moved = await goG2bNextPage(page, pageNo)
    if (!moved) break
    await waitIdle(page)
  }
  return items
}

async function waitForG2bSearchForm(page, timeout = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await isBidListFormVisible(page)) return true
    const hasType = await page.locator('[data-title="검색유형"]').count().catch(() => 0)
    if (hasType > 0) return true
    await waitIdle(page)
    await delay(250)
  }
  return false
}

async function selectG2bSearchType(page, value, logs) {
  await waitForG2bSearchForm(page)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const clicked = await page.evaluate((value) => {
      const groups = [...document.querySelectorAll('[data-title="검색유형"]')]
      const group = groups.find((el) => {
        const style = getComputedStyle(el)
        const box = el.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width + box.height > 0
      }) || groups[0]
      if (!group) return false
      const nodes = [...group.querySelectorAll('input, label, span, a, li, div')]
      const target = nodes.find((el) => ((el.innerText || el.value || '').trim() === value))
      if (!target) return false
      const input = target.matches('input') ? target : (target.querySelector('input') || target)
      try {
        window.$w?.getComponentById?.(input.id)?.check?.()
      } catch {}
      input.click()
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      return true
    }, value).catch(() => false)

    if (clicked || await fillByLabel(page, '검색유형', value)) {
      await waitIdle(page)
      await delay(250)
      if (value === '개찰결과') {
        const gaechalSearch = page.locator('#mf_wfm_container_tacBidPbancLst_contents_tab2_body_btnS0005')
        await gaechalSearch.waitFor({ state: 'attached', timeout: 8000 }).catch(() => {})
      }
      logs.push(`검색유형 = ${value}`)
      return true
    }
    await delay(400)
  }
  logs.push(`검색유형을 찾지 못했습니다. (${value})`)
  return false
}

async function openG2bList(page, logs) {
  await page.goto('https://www.g2b.go.kr/', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await waitForReady(page, logs)
  await closePopups(page, logs)
  await followMenuPath(page, ['입찰', '입찰공고', '입찰공고목록'], logs)
  await waitIdle(page)
  const ready = await waitForG2bSearchForm(page)
  if (!ready) logs.push('입찰공고목록 검색화면을 기다리지 못했습니다.')
}

function dedupeItems(items) {
  const seen = new Set()
  const unique = []
  for (const item of items) {
    const key = noticeNumber(item.listRow) || pickValue(item.listRow, ['공고명'])
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}

async function collectGaechalListParallel(logs, errors) {
  logs.push('1차: 업종코드별 브라우저 3개로 개찰완료 목록을 수집합니다.')
  const groups = await Promise.all(INDUSTRY_CODES.map(async (code, index) => {
    await delay(index * 400)
    const session = await launchBrowser()
    try {
      await openG2bList(session.page, logs)
      const filled = await selectG2bSearchType(session.page, '개찰결과', logs)
      if (!filled) logs.push(`업종코드 ${code}: 검색유형 개찰결과 선택 실패`)
      return await collectGaechalListForCode(session.page, logs, code)
    } catch (error) {
      errors.push(`업종코드 ${code}: ${error.message}`)
      return []
    } finally {
      await session.close()
    }
  }))
  const items = dedupeItems(groups.flat())
  logs.push(`1차 완료: 개찰결과 ${items.length}건`)
  return items
}

async function collectDetailsForChunk(chunk, workerIndex, logs, errors) {
  if (!chunk.length) return
  const session = await launchBrowser()
  logs.push(`워커 ${workerIndex + 1}: ${chunk.length}건 상세 수집 시작`)
  try {
    await openG2bList(session.page, logs)
    logs.push(`워커 ${workerIndex + 1}: 2차-1 개찰상세`)
    for (const item of chunk) {
      const title = pickValue(item.listRow, ['공고명', '공사명']) || noticeNumber(item.listRow)
      try {
        const gaechal = await collectGaechalDetail(session.page, item.listRow, logs)
        item.gaechalDetail = gaechal.gaechalDetail
        item.bidders = gaechal.bidders
        logs.push(`워커 ${workerIndex + 1} 개찰상세: ${title}`)
      } catch (error) {
        errors.push(`${title}: ${error.message}`)
        await recoverG2bList(session.page, logs, '개찰결과').catch(() => {})
      }
    }

    logs.push(`워커 ${workerIndex + 1}: 2차-2 입찰공고 상세`)
    await selectG2bSearchType(session.page, '입찰공고', logs)
    for (const item of chunk) {
      const title = pickValue(item.listRow, ['공고명', '공사명']) || noticeNumber(item.listRow)
      try {
        item.noticeDetail = await collectNoticeDetail(session.page, item.listRow, logs)
        logs.push(`워커 ${workerIndex + 1} 입찰공고: ${title}`)
      } catch (error) {
        errors.push(`${title}: ${error.message}`)
        item.noticeDetail = {}
        await recoverG2bList(session.page, logs, '입찰공고').catch(() => {})
      }
    }
  } finally {
    await session.close()
  }
}

export async function scrapeG2b() {
  const logs = []
  const errors = []
  attachProgress(logs, errors)
  try {
    logs.push('나라장터 병렬 수집을 시작합니다.')
    const collectedItems = await collectGaechalListParallel(logs, errors)
    logs.push(`1차에서 수집한 ${collectedItems.length}건의 상세를 브라우저 ${Math.min(DETAIL_WORKERS, Math.max(1, collectedItems.length))}개로 수집합니다.`)
    await mapPool(collectedItems, DETAIL_WORKERS, (chunk, index) => collectDetailsForChunk(chunk, index, logs, errors))

    const rows = collectedItems.map((item) => {
      const detail = { ...(item.gaechalDetail || {}), ...(item.noticeDetail || {}) }
      return buildResultRow({
        siteName: '나라장터',
        list: item.listRow || {},
        detail,
        bidders: item.bidders || [],
        regionLimit: g2bRegion(detail),
      })
    })

    logs.push(`나라장터 ${rows.length}건 수집`)
    setProgressRows(rows)
    finishProgress('done')
    return {
      rows,
      logs,
      errors,
      pageTitle: '나라장터',
      finalUrl: 'https://www.g2b.go.kr/',
    }
  } catch (error) {
    finishProgress('error', error.message || '스크래핑 중 오류가 발생했습니다.')
    error.logs = logs
    error.errors = errors
    throw error
  }
}
