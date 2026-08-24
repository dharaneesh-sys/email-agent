import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  fallback?: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleReset = () => this.setState({ hasError: false, error: null });

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="error-boundary" role="alert">
            <p className="error-boundary-title">Something went wrong</p>
            <p className="error-boundary-hint">{this.state.error?.message ?? 'This section crashed.'}</p>
            <button type="button" className="btn btn-secondary" onClick={this.handleReset}>
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
