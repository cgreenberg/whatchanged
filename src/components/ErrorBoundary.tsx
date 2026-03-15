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
          <p className="text-zinc-400 font-inter">Something went wrong displaying this section.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-2 text-electric-amber underline text-sm font-inter"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
