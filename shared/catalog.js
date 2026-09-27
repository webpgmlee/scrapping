export const OUTPUT_COLUMNS = [
  '지역제한',
  '입찰시작',
  '입찰종료',
  '발주처',
  '공사명',
  '기초금액',
  '낙찰투찰율',
  '당사투찰율',
  '낙찰사정율',
  '당사사정율',
  '추첨번호',
  '내 투찰가격(직접입찰)',
  '조달가격',
  '최저입찰가(입찰율)',
  '비고',
]

export const SITES = [
  {
    id: 'g2b',
    name: '나라장터',
    url: 'https://www.g2b.go.kr/',
    menuPath: ['입찰', '입찰공고', '입찰공고목록'],
  },
  {
    id: 'lh',
    name: '토지주택공사',
    url: 'https://ebid.lh.or.kr/',
    menuPath: ['입찰', '입찰공고', '개찰결과조회'],
  },
  {
    id: 'd2b',
    name: '국방부',
    url: 'https://www.d2b.go.kr/',
    listUrl: 'https://www.d2b.go.kr/peb/bid/bidResultList.do?key=545',
    menuPath: ['공사', '입찰', '입찰결과'],
  },
  {
    id: 'ex',
    name: '도로공사',
    url: 'https://ebid.ex.co.kr/',
    menuPath: ['입찰', '공사', '입찰결과(공사)'],
  },
]

export function listSiteCards() {
  return SITES.map(({ id, name, url, menuPath }) => ({
    id,
    name,
    url,
    menuPath: menuPath.join(' > '),
    buttonLabel: `${name} 조회시작`,
  }))
}
