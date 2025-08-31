import SmartCanvas from './components/SmartCanvas'

const App = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4 text-balance">Smart Canvas</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Draw with pen, highlighter, shapes, and text. Use layers, undo/redo, import images, and export PNG/JSON.
      </p>
      <SmartCanvas />
    </div>
  )
}

export default App