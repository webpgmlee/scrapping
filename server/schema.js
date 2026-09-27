export { OUTPUT_COLUMNS, SITES } from '../shared/catalog.js'

export const COMPANY_PATTERN = /필성건설(\s*주식회사)?/

export function emptyRow() {
  return Object.fromEntries(OUTPUT_COLUMNS.map((column) => [column, '']))
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function parseAmount(value) {
  if (value == null || value === '' || value === '-') return NaN
  const negative = /^\(.*\)$/.test(String(value).trim())
  const number = Number(
    String(value)
      .replace(/[()]/g, '')
      .replace(/,/g, '')
      .replace(/[원₩$%]/g, '')
      .replace(/\s/g, ''),
  )
  if (!Number.isFinite(number)) return NaN
  return negative ? -number : number
}

export function formatAmount(value) {
  const number = typeof value === 'number' ? value : parseAmount(value)
  if (!Number.isFinite(number)) return ''
  return String(Math.round(number))
}

export function formatRate(value) {
  const number = typeof value === 'number' ? value : parseAmount(value)
  if (!Number.isFinite(number)) return ''
  return String(Number(number.toFixed(3)))
}

export function calcRate(left, right) {
  const a = parseAmount(left)
  const b = parseAmount(right)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return ''
  return formatRate((a / b) * 100)
}

export function isCompanyName(name) {
  return COMPANY_PATTERN.test(normalizeText(name).replace(/\(주\)/g, '주식회사'))
}

function compactKey(text) {
  return String(text || '').replace(/\s+/g, '').replace(/[()[\]{}]/g, '').replace(/%/g, '').replace(/원$/, '')
}

function isLeakedLabel(value) {
  return /^(No|재입찰번호|입찰공고번호|공고명|수요기관|공고기관|진행상황|업무구분|참조번호|계약방법|구분|단계구분)$/.test(value)
    || /^[.·…]{2,}$/.test(value)
}

export function pickValue(source, labels) {
  const entries = Object.entries(source || {})
    .map(([key, value]) => ({ key: compactKey(key), value: normalizeText(value) }))
    .filter((item) => item.value && item.value !== '-' && !isLeakedLabel(item.value))

  for (const label of labels) {
    const compact = compactKey(label)
    const exact = entries.find((item) => item.key === compact)
    if (exact) return exact.value
  }

  for (const label of labels) {
    const compact = compactKey(label)
    if (compact.length < 3) continue
    const fuzzy = entries.find((item) => item.key !== compact && item.key.endsWith(compact))
    if (fuzzy) return fuzzy.value
  }
  return ''
}

export function joinValues(source, labels) {
  const values = labels.map((label) => pickValue(source, [label])).filter(Boolean)
  return [...new Set(values)].join(', ')
}

export function monthRange(separator = '-') {
  const to = new Date()
  const from = new Date()
  from.setMonth(from.getMonth() - 1)
  const fmt = (date) => {
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${yyyy}${separator}${mm}${separator}${dd}`
  }
  return { from: fmt(from), to: fmt(to) }
}

export function parseBidders(table) {
  if (!table?.rows?.length) return []
  return table.rows.map((row, index) => {
    const name = pickValue(row, ['업체명', '상호', '사업자명', '입찰자', '투찰업체', '회사명'])
    const rank = pickValue(row, ['순위', '등수']) || String(index + 1)
    const price = pickValue(row, ['투찰금액', '투찰가격', '입찰금액', '입찰가격', '입찰가', '투찰액', '입찰금액(원)'])
    const rate = pickValue(row, ['투찰률', '투찰율', '입찰률', '입찰율', '투찰비율', '투찰률(%)', '투찰율(%)'])
    return { rank, name, price, rate }
  }).filter((item) => item.name)
}

export function buildResultRow({ siteName, list = {}, detail = {}, bidders = [], regionLimit = '' }) {
  const row = emptyRow()
  const baseAmount =
    pickValue(detail, ['기초금액', '기초금액(원)', '예산금액', '설계금액', '기초예가']) ||
    pickValue(list, ['기초금액', '예산금액', '설계금액']) ||
    ''
  const winner = bidders.find((item) => String(item.rank) === '1') || bidders[0]
  const ours = bidders.find((item) => isCompanyName(item.name))
  let expectedAmount = pickValue(detail, ['예정가격', '예정금액']) || pickValue(list, ['예정가격']) || ''
  if (!expectedAmount && winner?.price && winner?.rate) {
    const price = parseAmount(winner.price)
    const rate = parseAmount(winner.rate)
    if (Number.isFinite(price) && Number.isFinite(rate) && rate !== 0) {
      expectedAmount = formatAmount(price / (rate / 100))
    }
  }
  const prices = bidders.map((item) => parseAmount(item.price)).filter((value) => Number.isFinite(value))
  const minPrice = prices.length ? Math.min(...prices) : NaN

  row.지역제한 = regionLimit || pickValue(detail, ['참가가능지역', '참가지역', '지역제한']) || '-'
  row.입찰시작 =
    pickValue(detail, ['입찰시작일', '입찰개시일', '입찰게시일', '공고일자', '공고일', '게시일시', '게시일', '입찰시작']) ||
    pickValue(list, ['입찰시작일', '입찰개시일', '공고일자', '공고일', '입찰게시일']) ||
    ''
  row.입찰종료 =
    pickValue(detail, ['입찰마감일', '입찰마감일시', '입찰서마감일시', '입찰/견적서 마감일', '견적서 마감일', '견적서마감일시', '입찰종료일']) ||
    pickValue(list, ['입찰마감일', '입찰마감일시', '입찰서마감일시', '개찰마감일시', '개찰일시']) ||
    ''
  row.발주처 =
    pickValue(detail, ['공고기관', '공고기관명', '발주기관', '발주처']) ||
    pickValue(list, ['공고기관', '발주기관', '수요기관']) ||
    siteName
  row.공사명 =
    pickValue(list, ['공고명', '입찰공고명', '공사명', '입찰건명', '사업명']) ||
    pickValue(detail, ['공고명', '입찰공고명', '공사명', '입찰건명', '사업명']) ||
    ''
  row.기초금액 = formatAmount(baseAmount)
  row.낙찰투찰율 = formatRate(winner?.rate) || calcRate(winner?.price, expectedAmount)
  row.당사투찰율 = ours ? formatRate(ours.rate) || calcRate(ours.price, expectedAmount) : ''
  row.낙찰사정율 = expectedAmount && baseAmount ? calcRate(expectedAmount, baseAmount) : ''
  row.당사사정율 = ours && expectedAmount && baseAmount ? calcRate(expectedAmount, baseAmount) : ''
  row.추첨번호 = ''
  row['내 투찰가격(직접입찰)'] = ours ? formatAmount(ours.price) : ''
  row.조달가격 = ''
  row['최저입찰가(입찰율)'] = Number.isFinite(minPrice) ? formatAmount(minPrice) : ''
  row.비고 = ours ? `${ours.rank} / ${bidders.length}` : ''
  return row
}
