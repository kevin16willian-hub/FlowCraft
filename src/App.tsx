import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './styles/excalidraw.css'
import './styles/canvas.css'
import { Studio } from './components/layout/Studio'

export default function App() {
  return (
    <ReactFlowProvider>
      <Studio />
    </ReactFlowProvider>
  )
}
