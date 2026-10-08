import React, { useEffect, useState } from 'react'
import { useOS } from '../os/store'
import { Glyph } from '../shell/AppIcon'
import type { AppProps } from '../os/types'

type Mode = 'basic' | 'advanced' | 'programmer'

/* ------------------------- expression evaluation -------------------------- */
function evaluate(input: string): number {
  const tokens = tokenize(input)
  const rpn = toRpn(tokens)
  const stack: number[] = []
  for (const t of rpn) {
    if (typeof t === 'number') stack.push(t)
    else {
      const b = stack.pop() ?? 0
      const a = stack.pop() ?? 0
      switch (t) {
        case '+': stack.push(a + b); break
        case '-': stack.push(a - b); break
        case '*': stack.push(a * b); break
        case '/': stack.push(a / b); break
        case '%': stack.push(a % b); break
        case '^': stack.push(Math.pow(a, b)); break
        case 'u-': stack.push(-b); break
        default: throw new Error('unknown operator')
      }
    }
  }
  if (!stack.length || Number.isNaN(stack[0])) throw new Error('error')
  return stack[stack.length - 1]
}

function tokenize(input: string): (number | string)[] {
  const out: (number | string)[] = []
  let i = 0
  const src = input.replace(/,/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      let num = ''
      while (i < src.length && /[0-9.eE]/.test(src[i])) num += src[i++]
      out.push(Number(num))
      continue
    }
    if (/[a-z]/i.test(ch)) {
      let name = ''
      while (i < src.length && /[a-z]/i.test(src[i])) name += src[i++]
      out.push(name.toLowerCase())
      continue
    }
    if (ch === 'π') { out.push(Math.PI); i++; continue }
    if (ch === '(') out.push('(')
    if (ch === ')') out.push(')')
    if ('+-*/%^'.includes(ch)) out.push(ch === '-' && (out.length === 0 || typeof out[out.length - 1] === 'string' && out[out.length - 1] !== ')') && !/[0-9π)]/.test(String(out[out.length - 1] ?? '')) ? 'u-' : ch)
    i++
  }
  return out
}

const FUNCS: Record<string, (x: number) => number> = {
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  asin: (x) => Math.asin(x),
  acos: (x) => Math.acos(x),
  sqrt: (x) => Math.sqrt(x),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  abs: (x) => Math.abs(x),
  cbrt: (x) => Math.cbrt(x),
}

function toRpn(tokens: (number | string)[]): (number | string)[] {
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3, 'u-': 4 }
  const out: (number | string)[] = []
  const ops: string[] = []
  for (const t of tokens) {
    if (typeof t === 'number') out.push(t)
    else if (t === '(') ops.push(t)
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!)
      ops.pop()
    } else if (FUNCS[t]) {
      // apply function to the next number or parenthesised expression
      ops.push(t)
    } else {
      while (ops.length && prec[ops[ops.length - 1]] >= (prec[t] ?? 0) && prec[t] !== 3) out.push(ops.pop()!)
      ops.push(t)
    }
  }
  while (ops.length) out.push(ops.pop()!)
  // fold functions onto the following value
  const folded: (number | string)[] = []
  for (const t of out) {
    if (typeof t === 'string' && FUNCS[t]) {
      const v = folded.pop()
      folded.push(FUNCS[t](typeof v === 'number' ? v : Number(v ?? 0)))
    } else folded.push(t)
  }
  return folded
}

const HISTORY_LIMIT = 30

export default function CalculatorApp({ api }: AppProps) {
  const [display, setDisplay] = useState('0')
  const [expr, setExpr] = useState('')
  const [memory, setMemory] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('basic')
  const [history, setHistory] = useState<{ expr: string; result: string }[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [base, setBase] = useState<10 | 16 | 8 | 2>(10)

  useEffect(() => {
    api.setTitle(`Calculator — ${display}`)
  }, [display])

  function push(token: string) {
    if (token === 'C') {
      setDisplay('0')
      setExpr('')
      return
    }
    if (token === '⌫') {
      setDisplay((d) => (d.length > 1 ? d.slice(0, -1) : '0'))
      setExpr((e) => e.slice(0, -1))
      return
    }
    if (token === '=') {
      const source = expr || display
      try {
        const result = evaluate(source)
        const formatted = formatNumber(result)
        setDisplay(formatted)
        setExpr('')
        setHistory((h) => [{ expr: source, result: formatted }, ...h].slice(0, HISTORY_LIMIT))
      } catch {
        setDisplay('Error')
        setExpr('')
      }
      return
    }
    if (token === '±') {
      setDisplay((d) => (d.startsWith('-') ? d.slice(1) : '-' + d))
      setExpr((e) => (e.startsWith('-') ? e.slice(1) : '-' + e))
      return
    }
    if (token === '1/x') {
      const v = Number(display)
      const result = v === 0 ? NaN : 1 / v
      setDisplay(formatNumber(result))
      setExpr('')
      return
    }
    if (token === 'x²') {
      const result = Number(display) ** 2
      setDisplay(formatNumber(result))
      setExpr('')
      return
    }
    if (token === '√') {
      setDisplay(formatNumber(Math.sqrt(Number(display))))
      setExpr('')
      return
    }
    const isDigit = /[0-9.]/.test(token)
    const next = isDigit && !expr && /[0-9.]$/.test(display) && /^[0-9.]+$/.test(display) ? display + token : (expr || display) + token
    setExpr((e) => (isDigit && !e && /^[0-9.]+$/.test(display) ? display + token : e + token))
    setDisplay(next)
  }

  function formatNumber(n: number) {
    if (!Number.isFinite(n)) return 'Error'
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
    const s = n.toPrecision(12).replace(/0+$/, '').replace(/\.$/, '')
    return s
  }

  const keys: { label: string; span?: number; tone?: string }[] = [
    { label: 'C', tone: 'fn' }, { label: '⌫', tone: 'fn' }, { label: '%', tone: 'fn' }, { label: '÷', tone: 'op' },
    { label: '7' }, { label: '8' }, { label: '9' }, { label: '×', tone: 'op' },
    { label: '4' }, { label: '5' }, { label: '6' }, { label: '−', tone: 'op' },
    { label: '1' }, { label: '2' }, { label: '3' }, { label: '+', tone: 'op' },
    { label: '±', tone: 'fn' }, { label: '0' }, { label: '.' }, { label: '=', tone: 'eq' },
  ]

  const advancedKeys = [
    ['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['π', 'π'],
    ['√', '√'], ['x²', 'x²'], ['^', '^'], ['ln', 'ln('],
    ['log', 'log('], ['1/x', '1/x'], ['(', '('], [')', ')'],
  ] as [string, string][]

  const toBase = (n: number, b: number) => {
    const v = Math.trunc(Math.abs(n))
    const neg = n < 0 ? '-' : ''
    return neg + v.toString(b).toUpperCase()
  }

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useOS.getState().activeId !== undefined) {
        const target = e.target as HTMLElement
        if (['INPUT', 'TEXTAREA'].includes(target?.tagName)) return
      }
      if (/^[0-9.]$/.test(e.key)) push(e.key)
      else if (e.key === '+') push('+')
      else if (e.key === '-') push('−')
      else if (e.key === '*' || e.key === 'x') push('×')
      else if (e.key === '/') push('÷')
      else if (e.key === 'Enter' || e.key === '=') push('=')
      else if (e.key === 'Backspace') push('⌫')
      else if (e.key === 'Escape') push('C')
      else if (e.key === '%') push('%')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expr, display])

  const numeric = Number(display.replace(/[^0-9.-]/g, '')) || 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--wm-window-bg)' }}>
      <div className="mint-toolbar" style={{ gap: 3 }}>
        {(['basic', 'advanced', 'programmer'] as Mode[]).map((m) => (
          <button key={m} className="btn-ghost" data-active={mode === m} onClick={() => setMode(m)} style={{ textTransform: 'capitalize' }}>
            {m}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" title="Memory" onClick={() => setMemory(numeric)}>
          MS
        </button>
        <button className="btn-ghost" title="Recall memory" onClick={() => memory !== null && setDisplay(formatNumber(memory))}>
          MR
        </button>
        <button className="btn-ghost" title="History" data-active={showHistory} onClick={() => setShowHistory(!showHistory)}>
          <Glyph name="Clock" size={15} />
        </button>
      </div>

      <div style={{ padding: 14, borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
        <div style={{ textAlign: 'right', opacity: 0.6, minHeight: 18, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{expr || ' '}</div>
        <div style={{ textAlign: 'right', fontSize: 34, fontWeight: 300, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {display}
        </div>
        {memory !== null && <div style={{ textAlign: 'right', fontSize: 11, opacity: 0.6 }}>M = {formatNumber(memory)}</div>}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 10, gap: 8 }}>
          {mode === 'advanced' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
              {advancedKeys.map(([label, token]) => (
                <button
                  key={label}
                  className="btn-ghost"
                  style={{ justifyContent: 'center', background: 'rgba(128,136,132,0.16)' }}
                  onClick={() => push(token === '√' ? '√' : token === 'x²' ? 'x²' : token === '1/x' ? '1/x' : token)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gridAutoRows: '1fr', gap: 6 }}>
            {keys.map((k) => (
              <button
                key={k.label}
                onClick={() => push(k.label === '×' ? '*' : k.label === '÷' ? '/' : k.label === '−' ? '-' : k.label)}
                style={{
                  fontSize: k.label.length === 1 && /[0-9.]/.test(k.label) ? 19 : 16,
                  borderRadius: 7,
                  cursor: 'pointer',
                  border: '1px solid rgba(0,0,0,0.2)',
                  background:
                    k.tone === 'eq'
                      ? 'linear-gradient(to bottom, var(--wm-accent), var(--wm-accent-dim))'
                      : k.tone === 'op'
                        ? 'rgba(128,136,132,0.28)'
                        : k.tone === 'fn'
                          ? 'rgba(128,136,132,0.16)'
                          : 'var(--wm-entry-bg)',
                  color: 'inherit',
                  fontWeight: k.tone === 'eq' || k.tone === 'op' ? 600 : 400,
                }}
              >
                {k.label}
              </button>
            ))}
          </div>

          {mode === 'programmer' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
              <span>HEX {toBase(numeric, 16)}</span>
              <span>DEC {toBase(numeric, 10)}</span>
              <span>OCT {toBase(numeric, 8)}</span>
              <span>BIN {toBase(numeric, 2)}</span>
            </div>
          )}
        </div>

        {showHistory && (
          <div style={{ width: 180, flex: 'none', borderLeft: '1px solid rgba(0,0,0,0.14)', overflow: 'auto', padding: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>History</div>
            {history.length === 0 && <div style={{ opacity: 0.65, fontSize: 12.5 }}>Calculations will appear here.</div>}
            {history.map((h, i) => (
              <div
                key={i}
                className="menu-item"
                style={{ display: 'block', textAlign: 'right' }}
                onClick={() => setDisplay(h.result)}
              >
                <div style={{ opacity: 0.65, fontSize: 11.5 }}>{h.expr}</div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{h.result}</div>
              </div>
            ))}
            {history.length > 0 && (
              <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setHistory([])}>
                <Glyph name="Trash2" size={13} /> Clear history
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 'none', padding: '3px 10px', fontSize: 11.5, borderTop: '1px solid rgba(0,0,0,0.16)', backgroundImage: 'linear-gradient(to bottom,#f2f3f1,#e6e8e4)', color: '#24292c' }}>
        Type on your keyboard too — digits, + − × ÷, Enter for equals, Esc clears.
      </div>
    </div>
  )
}
