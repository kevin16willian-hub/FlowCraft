// Extrai o ZIP oficial de ícones AWS e gera public/aws-icons/{service,group,category,resource} + manifest.json.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'aws-icons')
const zip = readdirSync(OUT).find((f) => f.toLowerCase().endsWith('.zip'))
if (!zip) throw new Error(`Nenhum .zip encontrado em ${OUT}`)

const tmp = mkdtempSync(join(tmpdir(), 'aws-icons-'))
execFileSync('unzip', ['-q', '-o', join(OUT, zip), '-x', '__MACOSX/*', '-d', tmp])

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const topDir = (prefix) => join(tmp, readdirSync(tmp).find((d) => d.startsWith(prefix)))
const svgs = (dir) => walk(dir).filter((f) => f.toLowerCase().endsWith('.svg'))
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const words = (s) => s.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
const category = (dir) => words(dir.replace(/^(Arch|Res)[_-]/, '').replace('Category_', ''))

// Serviços mais usados em diagramas, na ordem em que aparecem na toolbar.
const COMMON = [
  'Amazon-EC2', 'AWS-Lambda', 'Amazon-Simple-Storage-Service', 'Amazon-Aurora', 'Amazon-RDS', 'Amazon-DynamoDB',
  'Amazon-API-Gateway', 'Amazon-CloudFront', 'Amazon-Route-53', 'Elastic-Load-Balancing', 'Amazon-Virtual-Private-Cloud',
  'Amazon-Cognito', 'Amazon-Simple-Queue-Service', 'Amazon-Simple-Notification-Service', 'Amazon-CloudWatch',
  'AWS-Identity-and-Access-Management', 'Amazon-Elastic-Container-Service', 'Amazon-Elastic-Kubernetes-Service',
  'AWS-Fargate', 'Amazon-ElastiCache', 'AWS-Secrets-Manager', 'AWS-Key-Management-Service', 'Amazon-EventBridge',
  'AWS-Step-Functions', 'AWS-WAF', 'AWS-CloudFormation', 'Amazon-EFS', 'Amazon-Elastic-Block-Store',
]

rmSync(join(OUT, 'service'), { recursive: true, force: true })
rmSync(join(OUT, 'group'), { recursive: true, force: true })
rmSync(join(OUT, 'category'), { recursive: true, force: true })
rmSync(join(OUT, 'resource'), { recursive: true, force: true })
for (const d of ['service', 'group', 'category', 'resource']) mkdirSync(join(OUT, d), { recursive: true })

const items = []
const used = new Set()
const uniqueFile = (kind, base) => {
  let name = base
  for (let i = 2; used.has(`${kind}/${name}`); i++) name = `${base}-${i}`
  used.add(`${kind}/${name}`)
  return name
}

// Serviços (64px)
const commonRank = new Map(COMMON.map((n, i) => [n, i]))
for (const f of svgs(topDir('Architecture-Service-Icons')).filter((p) => /\/64\/Arch_.*_64\.svg$/.test(p))) {
  const raw = basename(f).replace(/^Arch_/, '').replace(/_64\.svg$/, '')
  const cat = category(basename(dirname(dirname(f))))
  const file = uniqueFile('service', slug(raw))
  cpSync(f, join(OUT, 'service', `${file}.svg`))
  items.push({
    key: `aws:${file}`, label: words(raw), category: cat, kind: 'service', file: `service/${file}.svg`,
    common: commonRank.has(raw), rank: commonRank.get(raw) ?? null,
  })
}

// Grupos (VPC, Subnet, Region...), todos em 32px; usa a variante clara quando há _Dark
const GROUP_KEEP = /^(AWS-Cloud|AWS-Account|Region|Virtual-private-cloud-VPC|Public-subnet|Private-subnet|Auto-Scaling-group|Corporate-data-center|Server-contents|EC2-instance-contents|Spot-Fleet|AWS-IoT-Greengrass-Deployment)_32$/
for (const f of svgs(topDir('Architecture-Group-Icons'))) {
  const raw = basename(f, '.svg')
  if (!GROUP_KEEP.test(raw)) continue
  const name = raw.replace(/_32$/, '')
  const file = uniqueFile('group', slug(name))
  cpSync(f, join(OUT, 'group', `${file}.svg`))
  items.push({ key: `aws:group:${file}`, label: words(name), category: 'Groups', kind: 'group', file: `group/${file}.svg`, common: true, rank: null })
}

// Availability Zone nao existe no pacote oficial: na AWS e so uma borda tracejada azul.
const AZ_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="3" y="3" width="26" height="26" rx="2" fill="none" stroke="#147EBA" stroke-width="2" stroke-dasharray="4 3"/></svg>'
writeFileSync(join(OUT, 'group', 'availability-zone.svg'), AZ_SVG)
items.push({ key: 'aws:group:availability-zone', label: 'Availability Zone', category: 'Groups', kind: 'group', file: 'group/availability-zone.svg', common: true, rank: null })

// Categorias (64px)
for (const f of svgs(topDir('Category-Icons')).filter((p) => /Arch-Category_64\//.test(p))) {
  const raw = basename(f, '.svg').replace(/^Arch-Category_/, '').replace(/_64$/, '')
  const file = uniqueFile('category', slug(raw))
  cpSync(f, join(OUT, 'category', `${file}.svg`))
  items.push({ key: `aws:cat:${file}`, label: words(raw), category: 'Categories', kind: 'category', file: `category/${file}.svg`, common: false, rank: null })
}

// Recursos (48px), ignora variantes Light
for (const f of svgs(topDir('Resource-Icons')).filter((p) => !/_Light\.svg$/i.test(p))) {
  const raw = basename(f, '.svg').replace(/^Res_/, '').replace(/_48$/, '')
  const cat = category(basename(dirname(f)))
  const file = uniqueFile('resource', slug(raw))
  cpSync(f, join(OUT, 'resource', `${file}.svg`))
  items.push({ key: `aws:res:${file}`, label: words(raw.replace(/_/g, ' - ')), category: cat, kind: 'resource', file: `resource/${file}.svg`, common: false, rank: null })
}

rmSync(tmp, { recursive: true, force: true })
items.sort((a, b) => a.kind.localeCompare(b.kind) || (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.label.localeCompare(b.label))
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ source: zip, generatedAt: new Date().toISOString(), items }, null, 1))
const count = (k) => items.filter((i) => i.kind === k).length
console.log(`service=${count('service')} group=${count('group')} category=${count('category')} resource=${count('resource')}`)
console.log(`common encontrados: ${items.filter((i) => i.common && i.kind === 'service').length}/${COMMON.length}`)
if (!existsSync(join(OUT, 'manifest.json'))) process.exit(1)
