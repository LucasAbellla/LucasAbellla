// Builds the statistics cards shown in the profile README, straight from the GitHub API:
//   assets/stats.svg          stars, contributions this year, pull requests, issues, repositories
//   assets/streak.svg         total contributions, current streak, longest streak
//   assets/contributions.svg  contributions per day over the last 31 days
//   assets/languages.svg      languages of the public repositories
// Runs every day in .github/workflows/stats.yml. Locally: GITHUB_TOKEN=... node scripts/stats.mjs
import { mkdirSync, writeFileSync } from 'node:fs'

const LOGIN = process.env.GITHUB_USER || 'LucasAbellla'
const TOKEN = process.env.GITHUB_TOKEN
if (!TOKEN) throw new Error('GITHUB_TOKEN is missing')

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return json.data
}

const profile = (
  await gql(
    `query($login: String!) {
      user(login: $login) {
        name
        createdAt
        pullRequests { totalCount }
        issues { totalCount }
        repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
          totalCount
          nodes {
            stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
          }
        }
      }
    }`,
    { login: LOGIN },
  )
).user

// the contribution calendar comes one year at a time
const days = []
const now = new Date()
for (let year = new Date(profile.createdAt).getUTCFullYear(); year <= now.getUTCFullYear(); year++) {
  const from = new Date(Date.UTC(year, 0, 1)).toISOString()
  const to = year === now.getUTCFullYear() ? now.toISOString() : new Date(Date.UTC(year, 11, 31, 23, 59, 59)).toISOString()
  const data = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar { weeks { contributionDays { date contributionCount } } }
        }
      }
    }`,
    { login: LOGIN, from, to },
  )
  for (const w of data.user.contributionsCollection.contributionCalendar.weeks) days.push(...w.contributionDays)
}
days.sort((a, b) => a.date.localeCompare(b.date))
const today = now.toISOString().slice(0, 10)
const past = days.filter((d) => d.date <= today)

// ---------- numbers ----------
const total = past.reduce((n, d) => n + d.contributionCount, 0)
const year = now.getUTCFullYear()
const thisYear = past.filter((d) => d.date.startsWith(String(year))).reduce((n, d) => n + d.contributionCount, 0)
const stars = profile.repositories.nodes.reduce((n, r) => n + r.stargazerCount, 0)

let longest = { len: 0, start: null, end: null }
let run = { len: 0, start: null }
for (const d of past) {
  if (d.contributionCount > 0) {
    run = run.len ? { len: run.len + 1, start: run.start } : { len: 1, start: d.date }
    if (run.len > longest.len) longest = { len: run.len, start: run.start, end: d.date }
  } else run = { len: 0, start: null }
}
// the current streak survives a day without contributions only if that day is today
let current = { len: 0, start: null, end: null }
{
  let i = past.length - 1
  if (i >= 0 && past[i].contributionCount === 0) i--
  const end = i >= 0 ? past[i].date : null
  while (i >= 0 && past[i].contributionCount > 0) {
    current = { len: current.len + 1, start: past[i].date, end }
    i--
  }
}

const langs = new Map()
for (const r of profile.repositories.nodes)
  for (const e of r.languages.edges) {
    const l = langs.get(e.node.name) ?? { size: 0, color: e.node.color || '#8b949e' }
    l.size += e.size
    langs.set(e.node.name, l)
  }
const topLangs = [...langs.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6)
const langTotal = topLangs.reduce((n, [, l]) => n + l.size, 0)

// ---------- drawing ----------
const FONT = `'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif`
const C = { bg: '#0d0d0d', line: '#2b2b2b', title: '#ffffff', text: '#c9c9c9', muted: '#7d7d7d', accent: '#ffffff' }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmt = (n) => n.toLocaleString('en-US')
const short = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '')
const range = (s) => (s.len ? `${short(s.start)} - ${short(s.end)}` : 'No streak yet')
// first name only, as in "Lucas's GitHub Stats"
const who = process.env.DISPLAY_NAME || (profile.name || LOGIN).split(' ')[0]
const card = (w, h, body, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
  <title>${esc(label)}</title>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" fill="${C.bg}" stroke="${C.line}"/>
${body}
</svg>
`
// small line icons (stroke only), drawn here
const ICON = {
  star: 'M8 1.5l2 4.2 4.6.6-3.4 3.2.9 4.5L8 11.8 3.9 14l.9-4.5L1.4 6.3 6 5.7z',
  commit: 'M8 5.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM0.5 8h4.7M10.8 8h4.7',
  pr: 'M4 2.5v11M4 2.5a1.5 1.5 0 1 0 0 .1M12 13.5V6.5a2 2 0 0 0-2-2H7.5M12 13.5a1.5 1.5 0 1 0 0 .1M9 3l-1.5 1.5L9 6',
  issue: 'M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM8 7.2v.1',
  repo: 'M3 2.5h9.5v9H4.2A1.2 1.2 0 0 0 3 12.7V2.5zM3 12.7a1.2 1.2 0 0 0 1.2 1.2h8.3',
}
const icon = (d, x, y) =>
  `<path d="${d}" transform="translate(${x} ${y})" fill="none" stroke="${C.text}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`

function statsCard() {
  const rows = [
    ['star', 'Total Stars Earned', stars],
    ['commit', `Contributions (${year})`, thisYear],
    ['pr', 'Total Pull Requests', profile.pullRequests.totalCount],
    ['issue', 'Total Issues', profile.issues.totalCount],
    ['repo', 'Public Repositories', profile.repositories.totalCount],
  ]
  const body = [
    `  <text x="25" y="35" fill="${C.title}" font-family="${FONT}" font-size="17" font-weight="600">${esc(who)}'s GitHub Stats</text>`,
    ...rows.map(
      ([k, label, value], i) => `  <g transform="translate(25 ${62 + i * 25})">
    ${icon(ICON[k], 0, -12)}
    <text x="26" y="0" fill="${C.text}" font-family="${FONT}" font-size="14" font-weight="600">${esc(label)}:</text>
    <text x="230" y="0" fill="${C.title}" font-family="${FONT}" font-size="14" font-weight="700">${fmt(value)}</text>
  </g>`,
    ),
    // ring with the year's contributions
    `  <circle cx="400" cy="100" r="44" fill="none" stroke="${C.line}" stroke-width="6"/>`,
    `  <circle cx="400" cy="100" r="44" fill="none" stroke="${C.accent}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(2 * Math.PI * 44 * Math.min(1, thisYear / Math.max(1, total))).toFixed(1)} 999" transform="rotate(-90 400 100)"/>`,
    `  <text x="400" y="104" text-anchor="middle" fill="${C.title}" font-family="${FONT}" font-size="22" font-weight="700">${fmt(thisYear)}</text>`,
    `  <text x="400" y="122" text-anchor="middle" fill="${C.muted}" font-family="${FONT}" font-size="10">in ${year}</text>`,
  ].join('\n')
  return card(495, 195, body, `${who}'s GitHub stats`)
}

function streakCard() {
  const col = (x, big, label, sub, ring) => `  <g transform="translate(${x} 0)">
    ${ring ? `<circle cx="0" cy="72" r="38" fill="none" stroke="${C.accent}" stroke-width="5"/>` : ''}
    <text x="0" y="${ring ? 82 : 82}" text-anchor="middle" fill="${C.title}" font-family="${FONT}" font-size="28" font-weight="700">${fmt(big)}</text>
    <text x="0" y="${ring ? 138 : 120}" text-anchor="middle" fill="${C.title}" font-family="${FONT}" font-size="14" font-weight="600">${esc(label)}</text>
    <text x="0" y="${ring ? 158 : 142}" text-anchor="middle" fill="${C.muted}" font-family="${FONT}" font-size="11">${esc(sub)}</text>
  </g>`
  const since = short(past.find((d) => d.contributionCount > 0)?.date ?? profile.createdAt.slice(0, 10))
  const body = [
    col(83, total, 'Total Contributions', `${since}, ${new Date(profile.createdAt).getUTCFullYear()} - Present`, false),
    `  <line x1="165" y1="28" x2="165" y2="167" stroke="${C.line}"/>`,
    col(248, current.len, 'Current Streak', range(current), true),
    `  <line x1="330" y1="28" x2="330" y2="167" stroke="${C.line}"/>`,
    col(412, longest.len, 'Longest Streak', range(longest), false),
  ].join('\n')
  return card(495, 195, body, `${who}'s contribution streak`)
}

function graphCard() {
  const last = past.slice(-31)
  const W = 1000
  const H = 300
  const L = 60
  const R = 30
  const T = 60
  const B = 50
  const max = Math.max(4, ...last.map((d) => d.contributionCount))
  const step = Math.ceil(max / 4)
  const top = step * 4
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, last.length - 1)
  const y = (v) => T + (H - T - B) * (1 - v / top)
  const pts = last.map((d, i) => [x(i), y(d.contributionCount)])
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')
  const area = `${line} L${x(last.length - 1).toFixed(1)} ${y(0)} L${L} ${y(0)} Z`
  const grid = [0, 1, 2, 3, 4]
    .map(
      (k) => `  <line x1="${L}" y1="${y(k * step)}" x2="${W - R}" y2="${y(k * step)}" stroke="${C.line}" stroke-dasharray="${k ? '3 4' : ''}"/>
  <text x="${L - 10}" y="${y(k * step) + 4}" text-anchor="end" fill="${C.muted}" font-family="${FONT}" font-size="11">${k * step}</text>`,
    )
    .join('\n')
  const labels = last
    .map((d, i) => `<text x="${x(i).toFixed(1)}" y="${H - B + 20}" text-anchor="middle" fill="${C.muted}" font-family="${FONT}" font-size="10">${Number(d.date.slice(8))}</text>`)
    .join('')
  const dots = pts.map(([px, py]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.2" fill="${C.accent}"/>`).join('')
  const body = [
    `  <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>`,
    `  <text x="${W / 2}" y="34" text-anchor="middle" fill="${C.title}" font-family="${FONT}" font-size="17" font-weight="600">${esc(who)}'s Contribution Graph</text>`,
    grid,
    `  <path d="${area}" fill="url(#fill)"/>`,
    `  <path d="${line}" fill="none" stroke="${C.accent}" stroke-width="2" stroke-linejoin="round"/>`,
    `  ${dots}`,
    `  ${labels}`,
    `  <text x="${W / 2}" y="${H - 8}" text-anchor="middle" fill="${C.muted}" font-family="${FONT}" font-size="11">Days (last 31)</text>`,
    `  <text x="18" y="${(T + H - B) / 2}" text-anchor="middle" fill="${C.muted}" font-family="${FONT}" font-size="11" transform="rotate(-90 18 ${(T + H - B) / 2})">Contributions</text>`,
  ].join('\n')
  return card(W, H, body, `${who}'s contributions over the last 31 days`)
}

function languagesCard() {
  const W = 495
  const H = 195
  let bx = 25
  const bar = topLangs
    .map(([, l]) => {
      const w = ((W - 50) * l.size) / Math.max(1, langTotal)
      const r = `<rect x="${bx.toFixed(1)}" y="52" width="${Math.max(0, w - 2).toFixed(1)}" height="10" rx="2" fill="${l.color}"/>`
      bx += w
      return r
    })
    .join('')
  const legend = topLangs
    .map(([name, l], i) => {
      const lx = 25 + (i % 2) * 225
      const ly = 95 + Math.floor(i / 2) * 28
      return `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${l.color}"/><text x="${lx + 18}" y="${ly}" fill="${C.text}" font-family="${FONT}" font-size="13" font-weight="600">${esc(name)} <tspan fill="${C.muted}">${((100 * l.size) / Math.max(1, langTotal)).toFixed(1)}%</tspan></text>`
    })
    .join('')
  const body = [
    `  <text x="25" y="35" fill="${C.title}" font-family="${FONT}" font-size="17" font-weight="600">Most Used Languages</text>`,
    `  ${bar}`,
    `  ${legend}`,
  ].join('\n')
  return card(W, H, body, 'Most used languages in public repositories')
}

mkdirSync('assets', { recursive: true })
writeFileSync('assets/stats.svg', statsCard())
writeFileSync('assets/streak.svg', streakCard())
writeFileSync('assets/contributions.svg', graphCard())
writeFileSync('assets/languages.svg', languagesCard())
console.log({ total, thisYear, current: current.len, longest: longest.len, stars, langs: topLangs.map(([n]) => n) })
