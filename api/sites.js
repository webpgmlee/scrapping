import { listSiteCards, OUTPUT_COLUMNS } from '../shared/catalog.js'

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    sites: listSiteCards(),
    columns: OUTPUT_COLUMNS,
    scraping: false,
  })
}
