import { useEffect, useMemo, useRef, useState } from 'react'
import { awsIconUrl, pushRecentAws, readRecentAws, type AwsItem, type AwsKind } from '../../utils/awsCatalog'
import { DropdownMenu, useCloseMenu } from '../ui/DropdownMenu'
import { MoreIcon } from '../ui/icons'
import { ToolButton } from '../ui/ToolButton'

const QUICK_GROUPS = ['group/aws-cloud.svg', 'group/region.svg', 'group/availability-zone.svg', 'group/virtual-private-cloud-vpc.svg', 'group/public-subnet.svg', 'group/private-subnet.svg']
const QUICK_SERVICES = 6
const MAX_CELLS = 150
const TABS: { kind: AwsKind; label: string }[] = [{ kind: 'service', label: 'Serviços' }, { kind: 'resource', label: 'Recursos' }, { kind: 'group', label: 'Grupos' }]

const Icon = ({ file }: { file: string }) => <img className="aws-tool-icon" src={awsIconUrl(file)} alt="" loading="lazy" draggable={false} />

type BodyProps = { items: AwsItem[]; recent: string[]; onPick: (item: AwsItem) => void }

function PaletteBody({ items, recent, onPick }: BodyProps) {
  const close = useCloseMenu()
  const [kind, setKind] = useState<AwsKind>('service')
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // autoFocus rolaria o container (overflow hidden) e deslocaria a toolbar.
  useEffect(() => { searchRef.current?.focus({ preventScroll: true }) }, [])

  const ofKind = useMemo(() => items.filter((item) => item.kind === kind), [items, kind])
  const categories = useMemo(() => [...new Set(ofKind.map((item) => item.category))].sort((a, b) => a.localeCompare(b)), [ofKind])
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    const rank = (item: AwsItem) => {
      const recentAt = recent.indexOf(item.key)
      return recentAt >= 0 ? recentAt : item.common ? 100 + (item.rank ?? 0) : 1000
    }
    return ofKind
      .filter((item) => (!category || item.category === category) && (!term || item.label.toLowerCase().includes(term) || item.category.toLowerCase().includes(term)))
      .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
  }, [ofKind, category, query, recent])

  return (
    <div className="aws-palette">
      <input ref={searchRef} className="aws-palette__search" type="search" value={query} placeholder="Buscar ícone (ex.: lambda, subnet)" aria-label="Buscar ícone AWS" onChange={(event) => setQuery(event.target.value)} />
      <div className="aws-palette__filters">
        {TABS.map((tab) => (
          <button key={tab.kind} type="button" className={kind === tab.kind ? 'active' : ''} onClick={() => { setKind(tab.kind); setCategory('') }}>{tab.label}</button>
        ))}
        {categories.length > 1 && (
          <select value={category} aria-label="Categoria" onChange={(event) => setCategory(event.target.value)}>
            <option value="">Todas as categorias</option>
            {categories.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
      </div>
      <div className="aws-palette__grid">
        {visible.slice(0, MAX_CELLS).map((item) => (
          <button key={item.key} type="button" className="aws-palette__cell" title={`${item.label} · ${item.category}`} onClick={() => { onPick(item); close() }}>
            <Icon file={item.file} />
            <span>{item.label}</span>
          </button>
        ))}
        {visible.length === 0 && <p className="aws-palette__empty">Nenhum ícone encontrado.</p>}
      </div>
      {visible.length > MAX_CELLS && <p className="aws-palette__empty">Mostrando {MAX_CELLS} de {visible.length}. Refine a busca ou escolha uma categoria.</p>}
    </div>
  )
}

type Props = { items: AwsItem[]; tool: string; onToolChange: (tool: string) => void }

// Atalhos para grupos e servicos mais comuns, seguidos da paleta completa.
export function AwsTools({ items, tool, onToolChange }: Props) {
  const [recent, setRecent] = useState(readRecentAws)
  const pick = (item: AwsItem) => { onToolChange(item.key); setRecent(pushRecentAws(item.key)) }

  const groups = QUICK_GROUPS.map((file) => items.find((item) => item.file === file)).filter((item): item is AwsItem => !!item)
  const common = items.filter((item) => item.kind === 'service' && item.common).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).slice(0, QUICK_SERVICES)
  const active = items.find((item) => item.key === tool)
  const hidden = !!active && !groups.includes(active) && !common.includes(active)

  const button = (item: AwsItem) => <ToolButton key={item.key} icon={<Icon file={item.file} />} title={item.label} checked={tool === item.key} onClick={() => pick(item)} />
  const recentExtra = recent.map((key) => items.find((item) => item.key === key)).filter((item): item is AwsItem => !!item && !groups.includes(item) && !common.includes(item)).slice(0, 2)

  return (
    <>
      <div className="App-toolbar__divider" />
      {groups.map(button)}
      <div className="App-toolbar__divider" />
      {common.map(button)}
      {recentExtra.length > 0 && <div className="App-toolbar__divider" />}
      {recentExtra.map(button)}
      <div className="App-toolbar__divider" />
      <DropdownMenu align="end" triggerIcon={<MoreIcon />} triggerTitle="Todos os ícones AWS" triggerClassName={`App-toolbar__extra-tools-trigger ${hidden && active && !recentExtra.includes(active) ? 'ToolIcon--checked' : ''}`}>
        <PaletteBody items={items} recent={recent} onPick={pick} />
      </DropdownMenu>
    </>
  )
}
