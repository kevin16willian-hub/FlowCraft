import { useReactFlow, useStore } from '@xyflow/react'
import { Modal } from '../ui/Modal'
import { HelpIcon, MinusIcon, PlusIcon, RedoIcon, UndoIcon } from '../ui/icons'
import { MAIN_TOOLS } from './Toolbar'

export function ZoomActions() {
  const { zoomIn, zoomOut, zoomTo } = useReactFlow()
  const zoom = useStore((state) => state.transform[2])

  return (
    <div className="zoom-actions">
      <button type="button" className="zoom-button zoom-out-button" aria-label="Diminuir zoom" onClick={() => { void zoomOut({ duration: 120 }) }}><MinusIcon /></button>
      <button type="button" className="zoom-button reset-zoom-button" aria-label="Redefinir zoom" onClick={() => { void zoomTo(1, { duration: 120 }) }}>{Math.round(zoom * 100)}%</button>
      <button type="button" className="zoom-button zoom-in-button" aria-label="Aumentar zoom" onClick={() => { void zoomIn({ duration: 120 }) }}><PlusIcon /></button>
    </div>
  )
}

type UndoRedoProps = { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }

export const UndoRedo = ({ canUndo, canRedo, onUndo, onRedo }: UndoRedoProps) => (
  <div className="zoom-actions undo-redo-buttons">
    <button type="button" className="zoom-button" aria-label="Desfazer" title="Desfazer — Ctrl+Z" disabled={!canUndo} onClick={onUndo}><UndoIcon /></button>
    <button type="button" className="zoom-button" aria-label="Refazer" title="Refazer — Ctrl+Y" disabled={!canRedo} onClick={onRedo}><RedoIcon /></button>
  </div>
)

export const HelpButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="help-icon" aria-label="Ajuda" title="Atalhos e ajuda" onClick={onClick}><HelpIcon /></button>
)

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Atalhos e ajuda" onClose={onClose}>
      <dl className="shortcut-list">
        {MAIN_TOOLS.map((tool) => (<div key={tool.id} style={{ display: 'contents' }}><dt>{tool.title}</dt><dd>{tool.key.toUpperCase()}</dd></div>))}
        <dt>Manter ferramenta ativa</dt><dd>Q</dd>
        <dt>Voltar à seleção</dt><dd>Esc</dd>
        <dt>Criar com tamanho livre</dt><dd>Escolha a ferramenta e arraste</dd>
        <dt>Mover a tela</dt><dd>Espaço + arrastar</dd>
        <dt>Zoom</dt><dd>Ctrl + roda do mouse</dd>
        <dt>Editar título</dt><dd>Duplo clique</dd>
        <dt>Desfazer / refazer</dt><dd>Ctrl+Z / Ctrl+Y</dd>
        <dt>Duplicar</dt><dd>Ctrl+D</dd>
        <dt>Copiar / colar / recortar</dt><dd>Ctrl+C / Ctrl+V / Ctrl+X</dd>
        <dt>Procurar na tela</dt><dd>Ctrl+F</dd>
        <dt>Selecionar vários</dt><dd>Ctrl + clique ou arrastar na tela</dd>
        <dt>Swimlane</dt><dd>Pool contém Lanes e Phases; solte elementos dentro da lane</dd>
        <dt>Colar print na etapa selecionada</dt><dd>Ctrl+V</dd>
        <dt>Excluir selecionado</dt><dd>Delete</dd>
        <dt>Conectar elementos</dt><dd>Arraste de um ponto roxo</dd>
        <dt>Agrupar em uma área</dt><dd>Solte o elemento dentro da área</dd>
      </dl>
    </Modal>
  )
}
