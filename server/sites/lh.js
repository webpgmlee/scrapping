import { clickSearch, closeDetail, clickDetail, closePopups, delay, fillByLabel, followMenuPath, goNextPage, waitForReady, withBrowser } from '../browser.js'
import { extractFromDocument, extractPairsFromDocument } from '../extract.js'
import { buildResultRow, joinValues, monthRange, parseBidders, pickValue } from '../schema.js'

const MAX_PAGES = 8
const MAX_ROWS = 40

function bestListTable(tables) {
  return tables.find((table) => /입찰건명|공고번호/.test(table.headers.join(' '))) || tables[0]
}

export async function scrapeLh() {
  return withBrowser(async ({ page, logs, errors }) => {
    logs.push('토지주택공사 접속')
    await page.goto('https://ebid.lh.or.kr/', { waitUntil: 'domcontentloaded', timeout: 45000 })
    await waitForReady(page, logs)
    await closePopups(page, logs)
    await followMenuPath(page, ['입찰', '입찰공고', '개찰결과조회'], logs)
    await closePopups(page, logs)

    const { from, to } = monthRange('/')
    const filledFrom = await fillByLabel(page, '개찰마감일시', from)
    if (!filledFrom) {
      const dates = page.locator('input[type="text"][id*="date" i], input[id*="Date"], input[class*="date"]')
      if ((await dates.count().catch(() => 0)) >= 2) {
        await dates.nth(0).fill(from)
        await dates.nth(1).fill(to)
        logs.push(`개찰마감일시 ${from} ~ ${to}`)
      } else {
        logs.push('개찰마감일시 입력칸을 찾지 못했습니다.')
      }
    } else {
      const dates = page.locator('input[type="text"]').filter({ visible: true })
      if ((await dates.count()) >= 2) await dates.nth(1).fill(to).catch(() => {})
      logs.push(`개찰마감일시 ${from} ~ ${to}`)
    }

    await clickSearch(page, logs)
    const rows = []
    let collected = 0

    for (let pageNo = 1; pageNo <= MAX_PAGES && collected < MAX_ROWS; pageNo += 1) {
      const tables = await page.evaluate(extractFromDocument)
      const list = bestListTable(tables)
      if (!list?.rows?.length) {
        logs.push(`${pageNo}페이지 목록 없음`)
        break
      }
      logs.push(`${pageNo}페이지 목록 ${list.rows.length}건`)
      const dataRows = page.locator('table tbody tr').filter({ has: page.locator('td a, td button') })
      const count = Math.min(await dataRows.count().catch(() => 0), list.rows.length, MAX_ROWS - collected)

      for (let index = 0; index < count; index += 1) {
        const listRow = list.rows[index] || {}
        try {
          const popup = await clickDetail(page, dataRows.nth(index), logs)
          const detailPage = popup || page
          await delay(350)
          const detail = await detailPage.evaluate(extractPairsFromDocument)
          const detailTables = await detailPage.evaluate(extractFromDocument)
          const bidders = detailTables.find((table) => /순위|업체|투찰/.test(table.headers.join(' ')))
          rows.push(buildResultRow({
            siteName: '토지주택공사',
            list: listRow,
            detail,
            bidders: parseBidders(bidders),
            regionLimit: joinValues(detail, ['참가지역1', '참가지역2', '참가지역3', '참가지역4', '참가지역']) || '-',
          }))
          await closeDetail(detailPage, page)
        } catch (error) {
          errors.push(`${pickValue(listRow, ['입찰건명', '공고명']) || index + 1}: ${error.message}`)
          rows.push(buildResultRow({ siteName: '토지주택공사', list: listRow, detail: {}, bidders: [] }))
        }
        collected += 1
      }

      if (!(await goNextPage(page))) break
    }

    logs.push(`토지주택공사 ${rows.length}건 수집`)
    return rows
  })
}
