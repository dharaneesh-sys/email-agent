import { ArrowsClockwise } from '@phosphor-icons/react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  fallback?: ReactNode;
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  onReset?: () => void;
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
    this.props.onError?.(error, info);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="error-boundary" role="alert">
            <span className="list-state-ring is-error" aria-hidden="true" />
            <p className="error-boundary-title">Something went wrong</p>
            <p className="error-boundary-hint">{this.state.error?.message ?? 'This section crashed.'}</p>
            <button type="button" className="btn btn-primary" onClick={this.handleReset}>
              <ArrowsClockwise size={16} aria-hidden="true" />
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
