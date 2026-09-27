import { clickSearch, closeDetail, clickDetail, closePopups, delay, followMenuPath, goNextPage, waitForReady, withBrowser } from '../browser.js'
import { extractFromDocument, extractPairsFromDocument } from '../extract.js'
import { buildResultRow, joinValues, parseBidders, pickValue } from '../schema.js'

const MAX_PAGES = 8
const MAX_ROWS = 40

export async function scrapeD2b() {
  return withBrowser(async ({ page, logs, errors }) => {
    logs.push('국방부 접속')
    await page.goto('https://www.d2b.go.kr/', { waitUntil: 'domcontentloaded', timeout: 45000 })
    await waitForReady(page, logs)
    await closePopups(page, logs)
    await followMenuPath(page, ['공사', '입찰', '입찰결과'], logs)
    if (!/bidResult/i.test(page.url())) {
      await page.goto('https://www.d2b.go.kr/peb/bid/bidResultList.do?key=545', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
      logs.push('공사 입찰결과 화면으로 이동')
    }

    const month = page.getByText('최근 1개월', { exact: true }).filter({ visible: true }).first()
    if ((await month.count().catch(() => 0)) > 0) {
      await month.click({ force: true })
      logs.push('개찰일자: 최근 1개월')
    } else {
      logs.push('최근 1개월 버튼을 찾지 못했습니다.')
    }
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
            siteName: '국방부',
            list: listRow,
            detail,
            bidders: parseBidders(bidders),
            regionLimit: joinValues(detail, ['지역1', '지역2', '지역3', '지역4', '지역5', '제한지역']) || '-',
          }))
          await closeDetail(detailPage, page)
        } catch (error) {
          errors.push(`${pickValue(listRow, ['공사명', '공고명', '사업명']) || index + 1}: ${error.message}`)
          rows.push(buildResultRow({ siteName: '국방부', list: listRow, detail: {}, bidders: [] }))
        }
        collected += 1
      }
      if (!(await goNextPage(page))) break
    }

    logs.push(`국방부 ${rows.length}건 수집`)
    return rows
  })
}
