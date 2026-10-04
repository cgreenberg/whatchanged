'use client'
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="text-center py-8">
          <p className="text-ink-2">Something went wrong displaying this section.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 text-ink underline underline-offset-4 text-sm"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
