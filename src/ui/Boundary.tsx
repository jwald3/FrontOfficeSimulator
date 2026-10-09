import { Component, type ReactNode } from 'react'

/** Keeps a render error from blanking the screen; the saved run is untouched. */
export class Boundary extends Component<{ children: ReactNode; onReset: () => void }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="loading">
        <div className="display loading-mark">Fumble.</div>
        <p className="muted">Something broke on that play. Your saved offseason is safe.</p>
        <code className="muted">{this.state.error.message}</code>
        <button
          className="btn"
          onClick={() => {
            this.setState({ error: undefined })
            this.props.onReset()
          }}
        >
          Back to the main menu
        </button>
      </div>
    )
  }
}
