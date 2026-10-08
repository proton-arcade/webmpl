import React, { useEffect, useMemo, useState } from 'react'
import { Glyph } from '../shell/AppIcon'
import { AppIcon } from '../shell/AppIcon'
import { notify } from '../os/bus'
import type { AppProps } from '../os/types'

const CITIES: { name: string; country: string; lat: number; lon: number; offset: number }[] = [
  { name: 'Mixtville', country: 'MixtNet', lat: 51.5, lon: -0.1, offset: 0 },
  { name: 'London', country: 'United Kingdom', lat: 51.5, lon: -0.12, offset: 0 },
  { name: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.4, offset: 1 },
  { name: 'New York', country: 'United States', lat: 40.71, lon: -74.0, offset: -5 },
  { name: 'San Francisco', country: 'United States', lat: 37.77, lon: -122.42, offset: -8 },
  { name: 'Tokyo', country: 'Japan', lat: 35.68, lon: 139.69, offset: 9 },
  { name: 'Sydney', country: 'Australia', lat: -33.87, lon: 151.21, offset: 11 },
  { name: 'Reykjavík', country: 'Iceland', lat: 64.14, lon: -21.94, offset: 0 },
  { name: 'Nairobi', country: 'Kenya', lat: -1.29, lon: 36.82, offset: 3 },
  { name: 'São Paulo', country: 'Brazil', lat: -23.55, lon: -46.63, offset: -3 },
]

const CONDITIONS = [
  { label: 'Sunny', glyph: 'Sun', p: 0.2 },
  { label: 'Partly cloudy', glyph: 'CloudSun', p: 0.3 },
  { label: 'Cloudy', glyph: 'Cloud', p: 0.2 },
  { label: 'Light rain', glyph: 'CloudRain', p: 0.15 },
  { label: 'Windy', glyph: 'Wind', p: 0.1 },
  { label: 'Clear night', glyph: 'Moon', p: 0.05 },
]

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function forecast(city: (typeof CITIES)[number]) {
  const day = Math.floor(Date.now() / 86_400_000)
  const rand = rng(hash(city.name) + day)
  const baseTemp = 22 - Math.abs(city.lat) * 0.28 + rand() * 8
  const days = Array.from({ length: 7 }).map((_, i) => {
    const r = rng(hash(city.name + i) + day)
    const condition = pickCondition(r)
    return {
      date: new Date(Date.now() + i * 86_400_000),
      high: Math.round(baseTemp + 3 - i * 0.3 + r() * 5),
      low: Math.round(baseTemp - 5 - i * 0.2 + r() * 4),
      condition,
      humidity: Math.round(40 + r() * 50),
      wind: Math.round(4 + r() * 28),
      rain: condition.label.includes('rain') ? 60 + Math.round(r() * 35) : Math.round(r() * 30),
    }
  })
  const hours = Array.from({ length: 12 }).map((_, i) => {
    const r = rng(hash(city.name + 'h' + i) + day)
    return { hour: (new Date().getHours() + i) % 24, temp: Math.round(baseTemp + 4 - i * 0.6 + r() * 3), rain: Math.round(r() * 70) }
  })
  return { days, hours, now: days[0], feels: Math.round(days[0].high - 1) }
}

function pickCondition(r: () => number) {
  const x = r()
  let acc = 0
  for (const c of CONDITIONS) {
    acc += c.p
    if (x <= acc) return c
  }
  return CONDITIONS[0]
}

export default function WeatherApp({ win, api }: AppProps) {
  const [city, setCity] = useState(CITIES.find((c) => c.name === win.props?.city) ?? CITIES[0])
  const [query, setQuery] = useState('')
  const [unit, setUnit] = useState<'C' | 'F'>('C')
  const [tick, setTick] = useState(0)
  const data = useMemo(() => forecast(city), [city, tick])

  useEffect(() => {
    api.setTitle(`${city.name} — Weather`)
    const t = setInterval(() => setTick((x) => x + 1), 300_000)
    return () => clearInterval(t)
  }, [city])

  const results = query.trim()
    ? CITIES.filter((c) => (c.name + c.country).toLowerCase().includes(query.toLowerCase()))
    : CITIES

  const conv = (t: number) => (unit === 'C' ? `${t}°` : `${Math.round((t * 9) / 5 + 32)}°`)

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: 'linear-gradient(170deg,#e8f2fa,#f6fbf4)' }}>
      <div style={{ width: 190, flex: 'none', borderRight: '1px solid rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 8 }}>
          <input className="entry" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a city…" style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {results.map((c) => (
            <div
              key={c.name}
              className="menu-item"
              style={{ background: c.name === city.name ? 'color-mix(in srgb, var(--wm-accent) 40%, transparent)' : undefined }}
              onClick={() => {
                setCity(c)
                setQuery('')
              }}
            >
              <Glyph name="MapPin" size={14} />
              <span style={{ flex: 1 }}>{c.name}</span>
              <span style={{ opacity: 0.6, fontSize: 11 }}>{c.country.slice(0, 3)}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: 8, borderTop: '1px solid rgba(0,0,0,0.1)', display: 'flex', gap: 6 }}>
          <button className="btn-ghost" data-active={unit === 'C'} onClick={() => setUnit('C')}>
            °C
          </button>
          <button className="btn-ghost" data-active={unit === 'F'} onClick={() => setUnit('F')}>
            °F
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <AppIcon glyph={data.now.condition.glyph} color="#48b0d8" color2="#1f6f96" size={78} />
          <div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{city.name}</div>
            <div style={{ opacity: 0.7 }}>
              {city.country} · updated {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} local
            </div>
            <div style={{ fontSize: 44, fontWeight: 300, lineHeight: 1.1 }}>{conv(data.now.high)}</div>
            <div style={{ fontSize: 15 }}>{data.now.condition.label} · feels like {conv(data.feels)}</div>
            <div style={{ opacity: 0.75, marginTop: 4, fontSize: 12.5 }}>
              High {conv(data.now.high)} · Low {conv(data.now.low)} · Humidity {data.now.humidity}% · Wind {data.now.wind} km/h
            </div>
          </div>
        </div>

        {/* hourly */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Next hours</div>
          <div style={{ display: 'flex', gap: 8, overflow: 'auto', paddingBottom: 6 }}>
            {data.hours.map((h, i) => (
              <div key={i} style={{ minWidth: 66, textAlign: 'center', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: '8px 6px', background: 'rgba(255,255,255,0.6)' }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>{String(h.hour).padStart(2, '0')}:00</div>
                <div style={{ fontSize: 16, margin: '3px 0' }}>{conv(h.temp)}</div>
                <div style={{ fontSize: 11, color: '#2b7fb8' }}>{h.rain}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* daily */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>7-day forecast</div>
          {data.days.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 4px', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ width: 92 }}>
                {i === 0 ? 'Today' : d.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
              </div>
              <AppIcon glyph={d.condition.glyph} color="#48b0d8" color2="#1f6f96" size={26} />
              <div style={{ width: 130, opacity: 0.85 }}>{d.condition.label}</div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ opacity: 0.7 }}>{conv(d.low)}</span>
                <div style={{ flex: 1, height: 5, background: 'rgba(120,140,160,0.25)', borderRadius: 999, position: 'relative', maxWidth: 200 }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: `${30 + i * 4}%`,
                      width: '38%',
                      height: '100%',
                      background: 'linear-gradient(90deg,#48b0d8,#f0b45a)',
                      borderRadius: 999,
                    }}
                  />
                </div>
                <span>{conv(d.high)}</span>
              </div>
              <div style={{ width: 54, textAlign: 'right', color: '#2b7fb8', fontSize: 12 }}>{d.rain}%</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button
            className="btn-ghost"
            onClick={() =>
              notify('Weather', `${city.name}: ${data.now.condition.label}, ${conv(data.now.high)}.\nForecast delivered by the MixtNet weather service.`)
            }
          >
            <Glyph name="Bell" size={14} /> Send to notification
          </button>
          <button className="btn-ghost" onClick={() => setTick((t) => t + 1)}>
            <Glyph name="RefreshCw" size={14} /> Refresh
          </button>
        </div>
        <div style={{ marginTop: 12, opacity: 0.6, fontSize: 11.5 }}>
          Data is generated deterministically from the city name and the date, so the forecast is stable, plausible and
          entirely fictional. The MixtNet has no satellites.
        </div>
      </div>
    </div>
  )
}
