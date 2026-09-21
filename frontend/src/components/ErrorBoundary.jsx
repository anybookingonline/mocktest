import React from 'react'

// ---------------------------------------------------------------------------
// Content-area error boundary. A render crash on any page (bad API shape,
// null deref, etc.) used to unmount the ENTIRE React tree -> blank page ->
// user reloads -> lands back on the dashboard, which felt like "menu click
// reloads the whole page". Wrapping only the content children inside AppShell
// keeps the sidebar + topbar alive: the right side shows a recoverable card
// and the menu stays exactly where it was.
// ---------------------------------------------------------------------------
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[UI] content crash:', error?.message, info?.componentStack?.slice(0, 400))
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center', padding: 28 }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <b style={{ display: 'block', margin: '8px 0' }}>Ye section load nahi ho paaya</b>
        <p className="small muted">
          Technical detail: {String(this.state.error?.message || this.state.error).slice(0, 160)}
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
          <button className="btn btn-primary" onClick={this.reset}>Dobara try karo</button>
          <button className="btn btn-ghost" onClick={() => window.location.assign('/')}>Dashboard par jao</button>
        </div>
      </div>
    )
  }
}
