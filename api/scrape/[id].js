export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(501).json({
    error: 'Vercel 배포에서는 브라우저 스크래핑을 실행할 수 없습니다. 로컬에서 npm run dev 후 조회해 주세요.',
  })
}
