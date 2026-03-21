'use client'
import { LineChart, Line, XAxis, YAxis, ReferenceArea, ReferenceLine, ResponsiveContainer } from 'recharts'

// Monthly data (like CPI — this works)
const monthlyData = [
  { date: '2023-03', value: 100 },
  { date: '2023-06', value: 102 },
  { date: '2023-09', value: 104 },
  { date: '2024-01', value: 106 },
  { date: '2024-06', value: 108 },
  { date: '2024-12', value: 110 },
  { date: '2025-01', value: 112 },
  { date: '2025-06', value: 115 },
  { date: '2026-01', value: 118 },
]

// Weekly data (like gas — this might NOT work)
const weeklyData = [
  { date: '2023-03-06', price: 4.10 },
  { date: '2023-06-05', price: 3.90 },
  { date: '2023-09-04', price: 4.20 },
  { date: '2024-01-01', price: 3.80 },
  { date: '2024-06-03', price: 4.00 },
  { date: '2024-12-30', price: 3.95 },
  { date: '2025-01-06', price: 4.10 },
  { date: '2025-06-02', price: 4.50 },
  { date: '2026-03-16', price: 5.00 },
]

export default function TestChart() {
  return (
    <div style={{ padding: 40, background: '#0a0a0a', minHeight: '100vh', color: 'white' }}>
      <h1>Recharts ReferenceArea Test</h1>

      <h2>Monthly dates (CPI-style) — should show blue before 2025-01</h2>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={monthlyData}>
            <XAxis dataKey="date" />
            <YAxis />
            <ReferenceArea x1="2023-03" x2="2025-01" fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} />
            <ReferenceArea x1="2025-01" x2="2026-01" fill="rgba(239, 68, 68, 0.25)" strokeOpacity={0} />
            <ReferenceLine x="2025-01" stroke="white" />
            <Line type="monotone" dataKey="value" stroke="#F59E0B" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2>Weekly dates (gas-style) — does blue show before 2025-01-06?</h2>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={weeklyData}>
            <XAxis dataKey="date" />
            <YAxis />
            <ReferenceArea x1="2023-03-06" x2="2025-01-06" fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} />
            <ReferenceArea x1="2025-01-06" x2="2026-03-16" fill="rgba(239, 68, 68, 0.25)" strokeOpacity={0} />
            <ReferenceLine x="2025-01-06" stroke="white" />
            <Line type="monotone" dataKey="price" stroke="#F59E0B" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2>Weekly dates with custom ticks (like our gas chart)</h2>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={weeklyData}>
            <XAxis dataKey="date" ticks={['2023-06-05', '2024-01-01', '2024-06-03', '2025-01-06', '2025-06-02', '2026-03-16']} />
            <YAxis />
            <ReferenceArea x1="2023-03-06" x2="2025-01-06" fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} />
            <ReferenceArea x1="2025-01-06" x2="2026-03-16" fill="rgba(239, 68, 68, 0.25)" strokeOpacity={0} />
            <ReferenceLine x="2025-01-06" stroke="white" />
            <Line type="monotone" dataKey="price" stroke="#F59E0B" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2>Weekly dates — ReferenceArea BEFORE other children</h2>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={weeklyData}>
            <ReferenceArea x1="2023-03-06" x2="2025-01-06" fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} />
            <ReferenceArea x1="2025-01-06" x2="2026-03-16" fill="rgba(239, 68, 68, 0.25)" strokeOpacity={0} />
            <XAxis dataKey="date" />
            <YAxis />
            <ReferenceLine x="2025-01-06" stroke="white" />
            <Line type="monotone" dataKey="price" stroke="#F59E0B" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2>Weekly dates with ifOverflow=&quot;extendDomain&quot;</h2>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={weeklyData}>
            <XAxis dataKey="date" />
            <YAxis />
            <ReferenceArea x1="2023-03-06" x2="2025-01-06" fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} ifOverflow="extendDomain" />
            <ReferenceArea x1="2025-01-06" x2="2026-03-16" fill="rgba(239, 68, 68, 0.25)" strokeOpacity={0} ifOverflow="extendDomain" />
            <ReferenceLine x="2025-01-06" stroke="white" />
            <Line type="monotone" dataKey="price" stroke="#F59E0B" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2>Weekly dates — using NUMERIC index instead of string</h2>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={weeklyData}>
            <XAxis dataKey="date" type="category" />
            <YAxis />
            <ReferenceArea x1="2023-03-06" x2="2025-01-06" fill="rgba(59, 130, 246, 0.25)" strokeOpacity={0} />
            <ReferenceArea x1="2025-01-06" x2="2026-03-16" fill="rgba(239, 68, 68, 0.25)" strokeOpacity={0} />
            <Line type="monotone" dataKey="price" stroke="#F59E0B" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
