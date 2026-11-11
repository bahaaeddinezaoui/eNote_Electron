import React from 'react'
import { tr } from '../i18n'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg m-4">
          <h2 className="text-lg font-semibold text-red-800 mb-2">{tr("Something went wrong")}</h2>
          <p className="text-red-600 mb-4">{this.state.error?.toString()}</p>
          <details className="text-sm text-ink-2">
            <summary className="cursor-pointer font-medium">{tr("Error details")}</summary>
            <pre className="mt-2 p-2 bg-red-100 rounded overflow-auto">
              {this.state.errorInfo?.componentStack}
            </pre>
          </details>
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >{tr("Try again")}</button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
