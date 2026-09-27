import { setProgressSite } from './progress.js'
import { SITES } from './schema.js'
import { scrapeG2b } from './sites/g2b.js'
import { scrapeLh } from './sites/lh.js'
import { scrapeD2b } from './sites/d2b.js'
import { scrapeEx } from './sites/ex.js'

const runners = {
  g2b: scrapeG2b,
  lh: scrapeLh,
  d2b: scrapeD2b,
  ex: scrapeEx,
}

export function listSites() {
  return SITES.map(({ id, name, url, menuPath }) => ({
    id,
    name,
    url,
    menuPath: menuPath.join(' > '),
    buttonLabel: `${name} 조회시작`,
  }))
}

export async function scrapeById(id) {
  const site = SITES.find((item) => item.id === id)
  const runner = runners[id]
  if (!site || !runner) {
    const error = new Error('지원하지 않는 사이트입니다.')
    error.status = 404
    throw error
  }
  setProgressSite(id)
  const result = await runner()
  return {
    siteId: site.id,
    siteName: site.name,
    ...result,
  }
}
