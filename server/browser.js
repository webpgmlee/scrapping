import { chromium } from 'playwright'
import { attachProgress, finishProgress, setProgressRows } from './progress.js'

export const SEARCH_BUTTON_PATTERN = /검색|조회|찾기|적용|확인|Search|Find|Submit|조회하기|Apply/i
const SKIP_FRAME = /processMsg|raonk|upload|about:blank/i

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function exactText(text) {
  return new RegExp(`^\\s*${escapeRegex(text)}\\s*$`)
}

export function contentFrames(page) {
  return page.frames().filter((frame) => !SKIP_FRAME.test(frame.url()))
}

export async function launchBrowser() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'],
  })
  const context = await browser.newContext({
    locale: 'ko-KR',
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  })
  await context.route('**/*', (route) => {
    const type = route.request().resourceType()
    if (type === 'image' || type === 'media' || type === 'font') {
      return route.abort()
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  return {
    browser,
    context,
    page,
    async close() {
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
    },
  }
}

export async function mapPool(items, workerCount, worker) {
  if (!items.length) return
  const count = Math.max(1, Math.min(workerCount, items.length))
  const groups = Array.from({ length: count }, () => [])
  items.forEach((item, index) => groups[index % count].push(item))
  await Promise.all(groups.filter((group) => group.length).map((group, index) => worker(group, index)))
}

export async function withBrowser(handler) {
  const session = await launchBrowser()
  const logs = []
  const errors = []
  attachProgress(logs, errors)
  try {
    const rows = await handler({ page: session.page, context: session.context, logs, errors })
    setProgressRows(rows ?? [])
    finishProgress('done')
    return {
      rows: rows ?? [],
      logs,
      errors,
      pageTitle: await session.page.title().catch(() => ''),
      finalUrl: session.page.url(),
    }
  } catch (error) {
    finishProgress('error', error.message || '스크래핑 중 오류가 발생했습니다.')
    error.logs = logs
    error.errors = errors
    throw error
  } finally {
    await session.close()
  }
}

export async function waitForReady(page, logs) {
  const html = await page.content().catch(() => '')
  const websquare = /websquare|WebSquareExternal/i.test(html)
  try {
    if (websquare) {
      await page.locator('#mf_wfm_gnb, [id*="wfm_gnbMenu"], [class*="w2textbox"]').first()
        .waitFor({ state: 'attached', timeout: 30000 })
      await delay(700)
    } else {
      await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {})
      await page.locator('table, form, nav, main, [role="navigation"]').first()
        .waitFor({ state: 'attached', timeout: 12000 })
        .catch(() => {})
    }
    logs.push('화면 로딩 완료')
  } catch {
    logs.push('화면 로딩 대기 시간 초과, 현재 상태로 진행합니다.')
  }
}

export async function closePopups(page, logs) {
  const closers = [
    page.locator('[class*="w2window_close"]'),
    page.locator('.w2popup_window input[value="닫기"], .w2popup_window a[title="닫기"]'),
    page.getByText('오늘하루 이 창을 열지 않음', { exact: false }),
    page.locator('a[title="닫기"], button.close').filter({ visible: true }),
  ]
  let closed = 0
  for (const locator of closers) {
    const count = Math.min(await locator.count().catch(() => 0), 8)
    for (let index = 0; index < count; index += 1) {
      if (!(await locator.nth(index).isVisible().catch(() => false))) continue
      await locator.nth(index).click({ force: true }).catch(() => {})
      closed += 1
      await delay(120)
    }
  }
  if (closed) logs.push(`안내 팝업 ${closed}개를 닫았습니다.`)
}

async function pointerHover(locator) {
  const box = await locator.boundingBox()
  if (box) {
    await locator.page().mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await delay(180)
    return
  }
  await locator.hover({ force: true, timeout: 2000 }).catch(() => {})
  await delay(180)
}

function menuLocators(scope, text) {
  const nav = scope.locator('nav, header, [role="navigation"], #mf_wfm_gnb, [id*="gnb"], [class*="gnb"], [class*="menu"]')
  return [
    nav.locator('a, button, [role="menuitem"]').filter({ hasText: exactText(text) }),
    scope.locator('a.depth1, a.depth2, a.depth3, a[id*="btn_menuLvl"]').filter({ hasText: exactText(text) }),
    scope.getByRole('link', { name: text, exact: true }),
    scope.getByRole('button', { name: text, exact: true }),
    scope.getByRole('menuitem', { name: text, exact: true }),
    scope.getByText(text, { exact: true }),
  ]
}

export async function findMenuLocator(page, text, visibleOnly = false) {
  for (const scope of [page, ...contentFrames(page)]) {
    for (const locator of menuLocators(scope, text)) {
      const matched = visibleOnly ? locator.filter({ visible: true }) : locator
      if ((await matched.count().catch(() => 0)) > 0) return matched.first()
    }
  }
  return null
}

export async function followMenuPath(page, menus, logs) {
  if (!menus?.length) return
  await page.getByText(menus[0], { exact: false }).first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {})

  for (let index = 0; index < menus.length; index += 1) {
    const text = menus[index]
    const isLast = index === menus.length - 1
    for (let parentIndex = 0; parentIndex < index; parentIndex += 1) {
      const parent =
        (await findMenuLocator(page, menus[parentIndex], true)) ??
        (await findMenuLocator(page, menus[parentIndex]))
      if (parent) await pointerHover(parent)
    }
    const locator =
      (await findMenuLocator(page, text, true)) ?? (await findMenuLocator(page, text))
    if (!locator) {
      logs.push(`메뉴를 찾지 못함: ${text}`)
      continue
    }
    if (!isLast) {
      await pointerHover(locator)
      logs.push(`메뉴 펼침: ${text}`)
      continue
    }
    const box = await locator.boundingBox()
    if (box) await locator.click({ timeout: 5000 }).catch(() => locator.click({ force: true }))
    else {
      await locator.evaluate((el) => {
        const target = el.closest('a, button') || el
        target.click()
      })
    }
    logs.push(`메뉴 클릭: ${text}`)
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
    await waitIdle(page)
    await delay(600)
  }
}

export async function fillByLabel(page, key, value) {
  const titled = page.locator(`[data-title="${key}"]`)
  if ((await titled.count().catch(() => 0)) > 0) {
    const option = titled.getByText(value, { exact: true })
    if ((await option.count().catch(() => 0)) > 0) {
      await option.first().click({ force: true })
      return true
    }
    const input = titled.locator('input:not([type="button"]):not([type="submit"]), textarea, select').filter({ visible: true }).first()
      .or(titled.locator('input:not([type="button"]):not([type="submit"]), textarea, select').first())
    if ((await input.count().catch(() => 0)) > 0) {
      await fillControl(input, value)
      return true
    }
  }

  const byTitle = page.locator(`input[title="${key}"], textarea[title="${key}"]`).filter({ visible: true }).first()
  if ((await byTitle.count().catch(() => 0)) > 0) {
    await fillControl(byTitle, value)
    return true
  }

  const header = page.locator('#mf_wfm_container th, #mf_wfm_container label').filter({ hasText: exactText(key) }).first()
  if ((await header.count().catch(() => 0)) > 0) {
    const row = header.locator('xpath=ancestor::tr[1]')
    const option = row.getByText(value, { exact: true })
    if ((await option.count().catch(() => 0)) > 0) {
      await option.first().click({ force: true })
      return true
    }
    const input = row.locator('input, textarea, select').filter({ visible: true }).first()
    if ((await input.count().catch(() => 0)) > 0) {
      await fillControl(input, value)
      return true
    }
  }
  return false
}

async function fillControl(input, value) {
  const tag = await input.evaluate((el) => el.tagName).catch(() => '')
  if (tag === 'SELECT') {
    await input.selectOption({ label: value }).catch(() => input.selectOption({ value }).catch(() => {}))
    return
  }
  await input.fill(value, { force: true, timeout: 5000 }).catch(async () => {
    await input.evaluate((el, next) => {
      el.value = next
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
  })
}

export async function clickSearch(page, logs) {
  const candidates = [
    page.locator('input.w2trigger.btn_cm.srch, input.btn_cm.srch, input[value="검색"], input[value="조회"]').filter({ visible: true }),
    page.locator('button[type="submit"], input[type="submit"]').filter({ visible: true }),
  ]
  for (const locator of candidates) {
    if ((await locator.count().catch(() => 0)) === 0) continue
    await locator.first().click({ force: true }).catch(() => locator.first().click())
    logs.push('검색 버튼 클릭')
    await delay(300)
    return true
  }
  logs.push('검색 버튼을 찾지 못했습니다.')
  return false
}

export async function goNextPage(page) {
  const scoped = page.locator('[class*="paging"], [class*="paginate"], [class*="pagination"], [class*="w2pageList"], [id*="pgl"], .pager')
  const next = scoped.locator('a, button, input[type="button"]').filter({ hasText: /다음|Next|›|»/ }).or(scoped.locator('a[title*="다음"], input[title*="다음"]')).filter({ visible: true }).first()
  if ((await next.count().catch(() => 0)) > 0) {
    const disabled = await next.getAttribute('class')
    if (disabled && /disabled|off|current/.test(disabled)) return false
    await next.click({ force: true }).catch(() => {})
    await delay(400)
    return true
  }
  return false
}

export async function waitIdle(page) {
  const bar = page.locator('#___processbar2, #___processbar').first()
  if (await bar.isVisible().catch(() => false)) {
    await bar.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  } else {
    await delay(200)
    if (await bar.isVisible().catch(() => false)) {
      await bar.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
    }
  }
  await delay(120)
}

export async function isBidListFormVisible(page) {
  const search = page
    .locator('#mf_wfm_container_tacBidPbancLst_contents_tab2_body_btnS0004, #mf_wfm_container_tacBidPbancLst_contents_tab2_body_btnS0005')
    .filter({ visible: true })
  return (await search.count().catch(() => 0)) > 0
}

function gaechalCompleteButtons(scope) {
  return scope
    .locator('#mf_wfm_container button, #mf_wfm_container input[type="button"], #mf_wfm_container input[type="submit"]')
    .filter({ hasText: /^\s*개찰완료\s*$/ })
    .or(scope.locator('#mf_wfm_container input[value="개찰완료"], #mf_wfm_container input[title="개찰완료"]'))
    .filter({ visible: true })
}

async function findGaechalControl(page, index = 0) {
  let remaining = index
  for (const scope of contentFrames(page)) {
    const buttons = gaechalCompleteButtons(scope)
    const count = await buttons.count().catch(() => 0)
    if (remaining < count) return buttons.nth(remaining)
    remaining -= count
  }
  return null
}

async function findGaechalControlByNumber(page, noticeNo) {
  const needle = String(noticeNo || '').replace(/-\d+$/, '').slice(0, 13)
  if (!needle) return null
  for (const scope of contentFrames(page)) {
    const buttons = gaechalCompleteButtons(scope)
    const count = await buttons.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const text = await buttons.nth(index).evaluate((el) => {
        const row = el.closest('tr') || el.closest('[class*="row"]') || el.parentElement
        return `${row?.innerText || ''} ${el.innerText || ''}`
      }).catch(() => '')
      if (text.includes(needle)) return buttons.nth(index)
    }
  }
  return null
}

export async function readGaechalListRows(page) {
  const rows = []
  for (const scope of contentFrames(page)) {
    const buttons = gaechalCompleteButtons(scope)
    const count = await buttons.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      rows.push(await recordFromControl(buttons.nth(index)))
    }
  }
  return rows
}

export async function countGaechalComplete(page) {
  let total = 0
  for (const scope of contentFrames(page)) {
    total += await gaechalCompleteButtons(scope).count().catch(() => 0)
  }
  return total
}

export async function waitForGaechalList(page, timeout = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if ((await countGaechalComplete(page).catch(() => 0)) > 0) return true
    await delay(250)
  }
  return false
}

async function recordFromControl(control) {
  return control.evaluate((el) => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim()
    const row = el.closest('tr') || el.closest('[class*="row"]') || el.parentElement
    const table = row?.closest('table')
    const headerRow = table?.querySelector('thead tr') || table?.querySelector('tr')
    const headers = [...(headerRow?.querySelectorAll('th, td') || [])].map((cell) => normalize(cell.innerText))
    const cells = [...(row?.querySelectorAll('th, td') || [])].map((cell) => normalize(cell.innerText))
    const record = {}
    headers.forEach((header, cellIndex) => {
      record[header || `컬럼${cellIndex + 1}`] = cells[cellIndex] || ''
    })
    if (!Object.keys(record).length) record.내용 = normalize(row?.innerText || el.innerText)
    return record
  }).catch(() => ({}))
}

export async function clickGaechalComplete(page, index, logs, noticeNo = '') {
  const control = (await findGaechalControlByNumber(page, noticeNo)) || (await findGaechalControl(page, index))
  if (!control) {
    throw new Error("진행상황 '개찰완료' 버튼을 찾지 못했습니다.")
  }

  const listRow = await recordFromControl(control)
  const popupPromise = page.context().waitForEvent('page', { timeout: 2500 }).catch(() => null)
  await control.click({ force: true }).catch(async () => {
    await control.evaluate((el) => {
      const target = el.closest('a, button, input, [onclick], [class*="w2trigger"]') || el
      target.click()
    })
  })
  logs.push("진행상황 '개찰완료' 클릭")
  return { popup: await popupPromise, listRow }
}

export async function waitForGaechalDetail(page, popup, timeout = 10000) {
  if (popup && !popup.isClosed()) return true
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const listForm = await isBidListFormVisible(page)
    const listBtn = await page
      .locator('#mf_wfm_container_btnLst, #mf_wfm_container_btnLstPop, #mf_wfm_container_btnBackList')
      .filter({ visible: true })
      .count()
      .catch(() => 0)
    if (!listForm && listBtn > 0) return true
    if (!listForm && (await countGaechalComplete(page).catch(() => 0)) === 0) return true
    await delay(300)
  }
  return false
}

async function findListBackButton(page) {
  for (const scope of contentFrames(page)) {
    const candidates = [
      scope.locator('#mf_wfm_container_btnLst'),
      scope.locator('#mf_wfm_container_btnLstPop'),
      scope.locator('#mf_wfm_container_btnBackList'),
      scope.locator('input[id*="btnLst"], input[id*="btnBackList"]'),
      scope.locator('input.btn_cm.list, input[value="목록"]'),
    ]
    for (const locator of candidates) {
      const matched = locator.filter({ visible: true }).first()
      if ((await matched.count().catch(() => 0)) > 0) return matched
    }
  }
  return null
}

async function clickWebSquare(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  await locator.evaluate((el) => {
    el.focus()
    el.click()
    try {
      const comp = window.$w?.getComponentById?.(el.id)
      if (comp?.click) comp.click()
      else if (comp?.trigger) comp.trigger('onclick')
    } catch {}
  }).catch(async () => {
    await locator.click({ force: true })
  })
}

export async function returnToGaechalList(page, popup, logs) {
  if (popup && !popup.isClosed()) {
    await popup.close().catch(() => {})
  }
  await closePopups(page, []).catch(() => {})

  if (await isBidListFormVisible(page)) {
    await waitIdle(page)
    return true
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const back = await findListBackButton(page)
    if (back) {
      await clickWebSquare(back)
      logs.push('목록으로 돌아가기')
    } else if (attempt >= 3) {
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
    }
    await waitIdle(page)
    await delay(250)
    if (await isBidListFormVisible(page)) return true
  }

  const restored = await isBidListFormVisible(page)
  if (!restored) logs.push('목록 화면 복귀에 실패했습니다.')
  return restored
}

export async function clickNamedControl(page, rowLocator, name, logs) {
  const control = rowLocator
    .locator(`input[value="${name}"], button, a, span, div, [class*="w2trigger"]`)
    .filter({ hasText: new RegExp(`^\\s*${escapeRegex(name)}\\s*$`) })
    .or(rowLocator.locator(`input[value="${name}"]`))
    .first()

  if ((await control.count().catch(() => 0)) === 0) {
    throw new Error(`'${name}' 버튼을 찾지 못했습니다.`)
  }

  const popupPromise = page.context().waitForEvent('page', { timeout: 2500 }).catch(() => null)
  await control.click({ force: true }).catch(async () => {
    await control.evaluate((el) => {
      const target = el.closest('a, button, input, [onclick], [class*="w2trigger"]') || el
      target.click()
    })
  })
  logs.push(`'${name}' 버튼 클릭`)
  return popupPromise
}

export function completeBidRows(page) {
  return page.locator('tr').filter({
    has: page.locator(
      'input[value="개찰완료"], button, a, span, [class*="w2trigger"]',
    ).filter({ hasText: /^\s*개찰완료\s*$/ }).or(page.locator('input[value="개찰완료"]')),
  })
}

export async function clickDetail(page, rowLocator, logs) {
  const link = rowLocator.locator('a').filter({ visible: true }).first()
  if ((await link.count().catch(() => 0)) > 0) {
    const popupPromise = page.context().waitForEvent('page', { timeout: 2500 }).catch(() => null)
    await link.click({ force: true }).catch(() => link.click())
    const popup = await popupPromise
    logs.push('상세 화면 링크 클릭')
    return popup
  }

  const button = rowLocator.locator('button, input[type="button"]').filter({ visible: true }).first()
  if ((await button.count().catch(() => 0)) > 0) {
    const popupPromise = page.context().waitForEvent('page', { timeout: 2500 }).catch(() => null)
    await button.click({ force: true })
    const popup = await popupPromise
    logs.push('상세 화면 버튼 클릭')
    return popup
  }

  throw new Error('상세 화면에 접근할 수 있는 a/button 태그를 찾지 못했습니다.')
}

export async function closeDetail(page, opener) {
  if (page !== opener) {
    await page.close().catch(() => {})
    return
  }
  const back = opener.getByRole('button', { name: /목록|닫기|이전/ }).filter({ visible: true }).first()
  if ((await back.count().catch(() => 0)) > 0) {
    await back.click({ force: true }).catch(() => {})
    await delay(350)
    return
  }
  await opener.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await delay(350)
}
