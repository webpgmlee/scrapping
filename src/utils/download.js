import * as XLSX from 'xlsx'

export function downloadXlsx(rows, columns = Object.keys(rows[0] || {}), sheetName = '결과') {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: columns })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31) || '결과')
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  XLSX.writeFile(workbook, `bid-aggregate-${stamp}.xlsx`)
}
