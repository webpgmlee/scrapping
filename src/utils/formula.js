const IDENTIFIER = /[A-Za-z가-힣_][A-Za-z0-9가-힣_]*/g

export function parseFormula(input) {
  const trimmed = input?.trim()
  if (!trimmed) return null

  const eq = trimmed.indexOf('=')
  if (eq === -1) {
    return { name: '결과값', expression: trimmed }
  }

  return {
    name: trimmed.slice(0, eq).trim() || '결과값',
    expression: trimmed.slice(eq + 1).trim(),
  }
}

export function parseNumber(value) {
  if (value == null) return NaN
  let text = String(value).trim()
  if (!text || text === '-' || text === '.') return NaN

  const negative = /^\(.*\)$/.test(text)
  text = text
    .replace(/[()]/g, '')
    .replace(/,/g, '')
    .replace(/%/g, '')
    .replace(/[원₩$]/g, '')
    .replace(/\s/g, '')
    .trim()

  const number = Number(text)
  if (!Number.isFinite(number)) return NaN
  return negative ? -number : number
}

export function isNumericColumn(rows, column) {
  const samples = rows
    .slice(0, 30)
    .map((row) => row[column])
    .filter((value) => value != null && String(value).trim() !== '')
  if (!samples.length) return false
  const numericCount = samples.filter((value) => !Number.isNaN(parseNumber(value))).length
  return numericCount >= Math.ceil(samples.length / 2)
}

export function aliasColumns(rows, selectedColumns) {
  const numeric = selectedColumns.filter((column) => isNumericColumn(rows, column))
  return (numeric.length ? numeric : selectedColumns).slice(0, 26)
}

export function resultColumnName(formula, headers = []) {
  const base = formula?.name || '결과값'
  if (!headers.includes(base)) return base
  let suffix = 2
  while (headers.includes(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

function tokenize(expression) {
  const tokens = []
  const source = expression.trim()
  let index = 0

  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if ('+-*/()'.includes(char)) {
      tokens.push({ type: 'op', value: char })
      index += 1
      continue
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] ?? ''))) {
      const match = source.slice(index).match(/^\d+(?:\.\d+)?/)
      tokens.push({ type: 'number', value: Number(match[0]) })
      index += match[0].length
      continue
    }
    if (/[A-Za-z가-힣_]/.test(char)) {
      IDENTIFIER.lastIndex = 0
      const match = source.slice(index).match(IDENTIFIER)
      tokens.push({ type: 'id', value: match[0] })
      index += match[0].length
      continue
    }
    throw new Error(`수식에서 사용할 수 없는 문자입니다: ${char}`)
  }

  return tokens
}

function evaluateTokens(tokens, env) {
  let position = 0

  const peek = () => tokens[position]
  const consume = (expected) => {
    const token = tokens[position]
    if (!token || (expected && token.value !== expected)) {
      throw new Error('수식 형식이 올바르지 않습니다.')
    }
    position += 1
    return token
  }

  function parseExpression() {
    let value = parseTerm()
    while (peek()?.value === '+' || peek()?.value === '-') {
      const op = consume().value
      const right = parseTerm()
      value = op === '+' ? value + right : value - right
    }
    return value
  }

  function parseTerm() {
    let value = parseFactor()
    while (peek()?.value === '*' || peek()?.value === '/') {
      const op = consume().value
      const right = parseFactor()
      value = op === '*' ? value * right : value / right
    }
    return value
  }

  function parseFactor() {
    const token = peek()
    if (!token) throw new Error('수식이 비어 있습니다.')

    if (token.value === '+') {
      consume()
      return parseFactor()
    }
    if (token.value === '-') {
      consume()
      return -parseFactor()
    }
    if (token.value === '(') {
      consume('(')
      const value = parseExpression()
      consume(')')
      return value
    }
    if (token.type === 'number') {
      consume()
      return token.value
    }
    if (token.type === 'id') {
      consume()
      if (!(token.value in env) || Number.isNaN(env[token.value])) {
        throw new Error(`값 '${token.value}'를 숫자로 계산할 수 없습니다.`)
      }
      return env[token.value]
    }

    throw new Error('수식 형식이 올바르지 않습니다.')
  }

  const result = parseExpression()
  if (position !== tokens.length) {
    throw new Error('수식 형식이 올바르지 않습니다.')
  }
  return result
}

export function buildFormulaEnv(row, selectedColumns, rows = []) {
  const env = {}
  Object.keys(row).forEach((column) => {
    env[column] = parseNumber(row[column])
  })
  aliasColumns(rows.length ? rows : [row], selectedColumns).forEach((column, index) => {
    env[String.fromCharCode(65 + index)] = parseNumber(row[column])
  })
  return env
}

function substituteColumnNames(expression, env) {
  const names = Object.keys(env).sort((left, right) => right.length - left.length)
  let source = expression
  for (const name of names) {
    if (!name || Number.isNaN(env[name])) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(?<![A-Za-z가-힣0-9_])${escaped}(?![A-Za-z가-힣0-9_])`, 'g')
    source = source.replace(pattern, String(env[name]))
  }
  return source
}

export function evaluateFormula(formula, row, selectedColumns, rows = []) {
  if (!formula?.expression) return null
  const env = buildFormulaEnv(row, selectedColumns, rows)
  const replaced = substituteColumnNames(formula.expression, env)
  return evaluateTokens(tokenize(replaced), env)
}

export function applyFormulaToRows(rows, selectedColumns, formulaInput) {
  const columns = selectedColumns.length ? selectedColumns : Object.keys(rows[0] || {})
  const formula = parseFormula(formulaInput)
  const computedName = formula ? resultColumnName(formula, columns) : null

  return rows.map((row) => {
    const next = {}
    columns.forEach((column) => {
      next[column] = row[column]
    })
    if (!formula) return next

    try {
      const value = evaluateFormula(formula, row, columns, rows)
      next[computedName] = Number.isFinite(value) ? Number(Number(value.toFixed(6))) : ''
    } catch {
      next[computedName] = ''
    }
    return next
  })
}

export function previewHeaders(selectedColumns, formulaInput) {
  const columns = [...selectedColumns]
  const formula = parseFormula(formulaInput)
  if (!formula) return columns
  return [...columns, resultColumnName(formula, columns)]
}
