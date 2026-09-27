import { clickSearch, closeDetail, clickDetail, closePopups, delay, followMenuPath, goNextPage, waitForReady, withBrowser } from '../browser.js'
import { extractFromDocument, extractPairsFromDocument } from '../extract.js'
import { buildResultRow, parseBidders, pickValue } from '../schema.js'

const MAX_PAGES = 8
const MAX_ROWS = 40

export async function scrapeEx() {
  return withBrowser(async ({ page, logs, errors }) => {
    logs.push('도로공사 접속')
    await page.goto('https://ebid.ex.co.kr/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await waitForReady(page, logs)
    await closePopups(page, logs)
    await followMenuPath(page, ['입찰', '공사', '입찰결과(공사)'], logs)
    await clickSearch(page, logs)

    const rows = []
    let collected = 0
    for (let pageNo = 1; pageNo <= MAX_PAGES && collected < MAX_ROWS; pageNo += 1) {
      const tables = await page.evaluate(extractFromDocument)
      const list = tables[0]
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
            siteName: '도로공사',
            list: listRow,
            detail,
            bidders: parseBidders(bidders),
            regionLimit: '-',
          }))
          await closeDetail(detailPage, page)
        } catch (error) {
          errors.push(`${pickValue(listRow, ['공사명', '공고명', '입찰건명']) || index + 1}: ${error.message}`)
          rows.push(buildResultRow({ siteName: '도로공사', list: listRow, detail: {}, bidders: [] }))
        }
        collected += 1
      }
      if (!(await goNextPage(page))) break
    }

    logs.push(`도로공사 ${rows.length}건 수집`)
    return rows
  })
}
