import { chromium } from 'playwright'
import { extractFromDocument } from './extract.js'

const SEARCH_BUTTON_PATTERN = /검색|조회|찾기|적용|확인|Search|Find|Submit|조회하기|Apply/i
const SKIP_FRAME = /processMsg|raonk|upload|about:blank/i

function parseSearchConditions(raw) {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.+?)\s*[=:]\s*(.+)$/)
      if (!match) return null
      return { key: match[1].trim(), value: match[2].trim() }
    })
    .filter((item) => item?.key && item?.value)
}

function parseMenuPath(raw) {
  if (!raw?.trim()) return []
  return raw.split('>').map((item) => item.trim()).filter(Boolean)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function exactText(text) {
  return new RegExp(`^\\s*${escapeRegex(text)}\\s*$`)
}

function contentFrames(page) {
  return page.frames().filter((frame) => !SKIP_FRAME.test(frame.url()))
}

async function detectFrontEnd(page) {
  return page.evaluate(() => {
    const html = document.documentElement.outerHTML.slice(0, 250000)
    const has = (pattern) => pattern.test(html)
    const flags = {
      websquare: Boolean(window.WebSquare) || has(/websquare|WebSquareExternal/i),
      next: Boolean(document.querySelector('#__next')) || has(/__NEXT_DATA__/),
      nuxt: Boolean(window.__NUXT__) || has(/__NUXT__/),
      react: Boolean(
        document.querySelector('[data-reactroot], [data-reactid]') ||
          window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
      ) || has(/data-reactroot|__NEXT_DATA__/),
      vue: Boolean(window.__VUE__ || document.querySelector('[data-v-]')) || has(/__VUE__|data-v-/),
      angular: Boolean(document.querySelector('[ng-version], app-root, [ng-app]')),
      jquery: Boolean(window.jQuery),
      iframe: document.querySelectorAll('iframe').length > 0,
    }

    let label = 'HTML'
    if (flags.websquare) label = 'WebSquare'
    else if (flags.next) label = 'Next.js/React'
    else if (flags.nuxt) label = 'Nuxt/Vue'
    else if (flags.angular) label = 'Angular'
    else if (flags.react) label = 'React'
    else if (flags.vue) label = 'Vue'
    else if (flags.jquery) label = 'jQuery/HTML'
    if (flags.iframe && label === 'HTML') label = 'HTML+iframe'

    return {
      ...flags,
      spa: flags.websquare || flags.next || flags.nuxt || flags.react || flags.vue || flags.angular,
      label,
    }
  })
}

async function waitForFrontEnd(page, logs) {
  const kind = await detectFrontEnd(page)
  logs.push(`프론트 유형: ${kind.label}`)

  try {
    if (kind.websquare) {
      await page.locator('#mf_wfm_gnb, [id*="wfm_gnbMenu"], [class*="w2textbox"]').first()
        .waitFor({ state: 'attached', timeout: 30000 })
      await delay(1200)
    } else if (kind.spa) {
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
      await page.waitForFunction(() => {
        const root = document.querySelector('#root, #app, #__next, app-root, [data-reactroot]')
        return !root || root.childElementCount > 0 || (document.body?.innerText || '').length > 40
      }, { timeout: 20000 })
      await delay(400)
    } else {
      await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
      await page.locator('table, form, nav, main, [role="navigation"], [role="grid"]').first()
        .waitFor({ state: 'attached', timeout: 10000 })
        .catch(() => {})
    }
    logs.push('화면 로딩 완료')
  } catch {
    logs.push('화면 로딩 대기 시간 초과, 현재 상태로 진행합니다.')
  }

  return kind
}

async function closePopups(page, logs) {
  const closers = [
    page.locator('[class*="w2window_close"]'),
    page.getByRole('dialog').getByRole('button', { name: /닫기|Close|확인|Accept|동의|거부/i }),
    page.locator('[aria-label="닫기"], [aria-label="Close"], button.close, .modal .close'),
  ]

  let closed = 0
  for (const locator of closers) {
    const count = Math.min(await locator.count().catch(() => 0), 5)
    for (let index = 0; index < count; index += 1) {
      if (!(await locator.nth(index).isVisible().catch(() => false))) continue
      await locator.nth(index).click({ force: true }).catch(() => {})
      closed += 1
      await delay(150)
    }
  }
  if (closed) logs.push(`안내 팝업 ${closed}개를 닫았습니다.`)
}

async function pointerHover(locator) {
  const box = await locator.boundingBox()
  if (box) {
    await locator.page().mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await delay(400)
    return
  }
  await locator.hover({ force: true, timeout: 2000 }).catch(() => {})
  await locator.evaluate((el) => {
    const wrap = el.closest('li, div, nav, [role="menuitem"]') || el
    for (const node of [wrap, el]) {
      for (const type of ['mouseover', 'mouseenter', 'mousemove', 'focus']) {
        node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
      }
    }
  }).catch(() => {})
  await delay(400)
}

function menuLocators(scope, text) {
  const nav = scope.locator('nav, header, [role="navigation"], [role="menubar"], #mf_wfm_gnb, [id*="gnb"], [class*="gnb"], [class*="menu"]')
  return [
    nav.locator('a, button, [role="menuitem"], [role="link"]').filter({ hasText: exactText(text) }),
    scope.locator('a.depth1, a.depth2, a.depth3, a[id*="btn_menuLvl"], a[id*="btnMenu"]').filter({ hasText: exactText(text) }),
    scope.getByRole('link', { name: text, exact: true }),
    scope.getByRole('button', { name: text, exact: true }),
    scope.getByRole('menuitem', { name: text, exact: true }),
    scope.getByRole('tab', { name: text, exact: true }),
    scope.getByText(text, { exact: true }),
  ]
}

async function findMenuLocator(page, text, visibleOnly = false) {
  for (const scope of [page, ...contentFrames(page)]) {
    for (const locator of menuLocators(scope, text)) {
      const matched = visibleOnly ? locator.filter({ visible: true }) : locator
      if ((await matched.count().catch(() => 0)) > 0) return matched.first()
    }
  }
  return null
}

async function clickMenuNode(locator) {
  const box = await locator.boundingBox()
  if (box) {
    await locator.click({ timeout: 5000 }).catch(async () => {
      await locator.click({ force: true, timeout: 3000 })
    })
    return 'visible'
  }
  await locator.evaluate((el) => {
    const target = el.closest('a, button, [role="menuitem"], [id*="btn_menu"]') || el
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    if (typeof target.click === 'function') target.click()
  })
  return 'hidden'
}

async function followMenuPath(page, menus, logs) {
  await page.getByText(menus[0], { exact: false }).first()
    .waitFor({ state: 'attached', timeout: 20000 })
    .catch(() => {})

  for (let index = 0; index < menus.length; index += 1) {
    const text = menus[index]
    const isLast = index === menus.length - 1

    for (let parentIndex = 0; parentIndex < index; parentIndex += 1) {
      const parent =
        (await findMenuLocator(page, menus[parentIndex], true)) ??
        (await findMenuLocator(page, menus[parentIndex]))
      if (!parent) continue
      await pointerHover(parent)
      if (parentIndex === index - 1) {
        const expanded = await parent.getAttribute('aria-expanded').catch(() => null)
        if (expanded === 'false') await parent.click({ force: true }).catch(() => {})
      }
    }

    const locator =
      (await findMenuLocator(page, text, true)) ?? (await findMenuLocator(page, text))

    if (!locator) {
      logs.push(`메뉴를 찾지 못함: ${text}`)
      continue
    }

    if (!isLast) {
      await pointerHover(locator)
      const expanded = await locator.getAttribute('aria-expanded').catch(() => null)
      if (expanded === 'false') await locator.click({ force: true }).catch(() => {})
      logs.push(`메뉴 펼침: ${text}`)
      continue
    }

    const mode = await clickMenuNode(locator)
    logs.push(mode === 'hidden' ? `숨겨진 하위 메뉴 클릭: ${text}` : `메뉴 클릭: ${text}`)
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
    await page.locator('#___processbar2, [id*="processbar"], .loading, [aria-busy="true"]').first()
      .waitFor({ state: 'hidden', timeout: 12000 })
      .catch(() => {})
    await delay(800)
  }
}

async function setControlValue(scope, control, value) {
  const meta = await control.evaluate((el) => ({
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    role: (el.getAttribute('role') || '').toLowerCase(),
  }))

  if (meta.tag === 'select') {
    await control.selectOption({ label: value }).catch(async () => {
      await control.selectOption({ value })
    })
    return true
  }
  if (meta.type === 'radio' || meta.type === 'checkbox') {
    await control.check({ force: true }).catch(async () => {
      await control.click({ force: true })
    })
    return true
  }
  if (meta.role === 'combobox' || meta.role === 'listbox') {
    await control.click({ force: true })
    await delay(200)
    const option = scope.getByRole('option', { name: value, exact: false }).first()
    if ((await option.count().catch(() => 0)) > 0) {
      await option.click()
      return true
    }
  }
  await control.fill(value).catch(async () => {
    await control.click({ force: true })
    await control.pressSequentially(value, { delay: 20 })
  })
  return true
}

async function fillField(scope, key, value) {
  const titled = scope.locator(`[data-title="${key}"]`)
  if ((await titled.count().catch(() => 0)) > 0) {
    const option = titled.getByText(value, { exact: true })
    if ((await option.count().catch(() => 0)) > 0) {
      await option.first().click({ force: true })
      return true
    }
    const input = titled.locator('input:not([type="button"]):not([type="submit"]), textarea, select').first()
    if ((await input.count().catch(() => 0)) > 0) {
      await setControlValue(scope, input, value)
      return true
    }
  }

  const strategies = [
    () => scope.getByLabel(key, { exact: false }),
    () => scope.getByRole('textbox', { name: key, exact: false }),
    () => scope.getByRole('combobox', { name: key, exact: false }),
    () => scope.getByRole('searchbox', { name: key, exact: false }),
    () => scope.getByPlaceholder(key, { exact: false }),
    () => scope.locator(`[aria-label="${key}"], [title="${key}"]`),
    () => scope.locator(`input[name="${key}" i], select[name="${key}" i], textarea[name="${key}" i], input[id="${key}" i], select[id="${key}" i]`),
  ]

  for (const create of strategies) {
    const locator = create()
    if ((await locator.count().catch(() => 0)) === 0) continue
    await setControlValue(scope, locator.first(), value)
    return true
  }

  const header = scope.locator('th, label, span, p, div').filter({ hasText: exactText(key) }).first()
  if ((await header.count().catch(() => 0)) > 0) {
    const row = header.locator('xpath=ancestor::tr[1] | ancestor::*[self::div or self::li or self::section][1]')
    const option = row.getByText(value, { exact: true })
    if ((await option.count().catch(() => 0)) > 0) {
      await option.first().click({ force: true })
      return true
    }
    const input = row.locator('input:not([type="button"]):not([type="submit"]), textarea, select').first()
    if ((await input.count().catch(() => 0)) > 0) {
      await setControlValue(scope, input, value)
      return true
    }
  }

  const radio = scope.getByRole('radio', { name: value, exact: false })
  if ((await radio.count().catch(() => 0)) > 0) {
    await radio.first().check({ force: true }).catch(async () => {
      await radio.first().click({ force: true })
    })
    return true
  }

  return false
}

async function applySearchConditions(page, conditions, logs) {
  if (conditions.length) {
    await page.getByText(conditions[0].key, { exact: false }).first()
      .waitFor({ timeout: 20000 })
      .catch(() => {})
  }

  for (const { key, value } of conditions) {
    let filled = false
    for (const scope of [page, ...contentFrames(page)]) {
      filled = await fillField(scope, key, value)
      if (filled) break
    }
    logs.push(filled ? `검색조건 입력: ${key} = ${value}` : `검색조건을 찾지 못함: ${key}`)
  }

  for (const scope of [page, ...contentFrames(page)]) {
    const candidates = [
      scope.locator('input.w2trigger.btn_cm.srch, input.btn_cm.srch').filter({ visible: true }),
      scope.getByRole('button', { name: SEARCH_BUTTON_PATTERN }).filter({ visible: true }),
      scope.locator('input[type="submit"], button[type="submit"]').filter({ visible: true }),
      scope.getByText(SEARCH_BUTTON_PATTERN, { exact: true }).filter({ visible: true }),
    ]
    for (const locator of candidates) {
      if ((await locator.count().catch(() => 0)) === 0) continue
      await locator.first().click({ force: true }).catch(async () => {
        await locator.first().click({ timeout: 8000 })
      })
      logs.push('검색 버튼 클릭')
      return
    }
  }

  logs.push('검색 버튼을 찾지 못해 입력값만 적용했습니다.')
}

async function collectTables(page) {
  const tables = []
  for (const frame of contentFrames(page)) {
    const extracted = await frame.evaluate(extractFromDocument).catch(() => [])
    extracted.forEach((table) => {
      tables.push({
        ...table,
        name: `${table.name}${tables.length ? ` (${tables.length + 1})` : ''}`,
      })
    })
  }

  return tables
    .filter((table, index, list) => {
      const key = JSON.stringify(table.rows.slice(0, 3))
      return list.findIndex((item) => JSON.stringify(item.rows.slice(0, 3)) === key) === index
    })
    .sort((a, b) => b.rows.length - a.rows.length)
}

export async function scrapeSite({ url, menuPath, searchConditions }) {
  const logs = []
  const menus = parseMenuPath(menuPath)
  const conditions = parseSearchConditions(searchConditions)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    locale: 'ko-KR',
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)

  try {
    logs.push(`페이지 접속: ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await waitForFrontEnd(page, logs)
    await closePopups(page, logs)

    if (menus.length) {
      await followMenuPath(page, menus, logs)
      await delay(600)
    }

    if (conditions.length) {
      await applySearchConditions(page, conditions, logs)
      await page.locator('#___processbar2, [id*="processbar"], .loading, [aria-busy="true"]').first()
        .waitFor({ state: 'hidden', timeout: 15000 })
        .catch(() => {})
      await delay(800)
    }

    const tables = await collectTables(page)
    logs.push(tables.length ? `표 ${tables.length}개를 찾았습니다.` : '표를 찾지 못했습니다.')

    return {
      pageTitle: await page.title(),
      finalUrl: page.url(),
      logs,
      tables,
    }
  } catch (error) {
    error.logs = logs
    throw error
  } finally {
    await context.close()
    await browser.close()
  }
}

export { parseMenuPath, parseSearchConditions }
