import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage?: string;
  componentStack?: string;
}

// Catches render-time crashes anywhere below it so a single thrown error shows a
// recoverable fallback instead of an unrecoverable blank white screen. Styles are
// inline so the fallback renders even if the app's CSS failed to load.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message || String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.setState({ componentStack: info.componentStack?.slice(0, 600) ?? '' });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#3A3A3A',
          background: '#f5efe8',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: '28rem', margin: 0, opacity: 0.8 }}>
          This page hit an unexpected error. Reloading usually fixes it.
        </p>
        {this.state.errorMessage && (
          <p style={{ maxWidth: '28rem', margin: 0, fontSize: '0.75rem', fontFamily: 'monospace', background: '#fff', padding: '0.5rem', borderRadius: '0.25rem', wordBreak: 'break-all' }}>
            {this.state.errorMessage}
          </p>
        )}
        {this.state.componentStack && (
          <p style={{ maxWidth: '28rem', margin: 0, fontSize: '0.65rem', fontFamily: 'monospace', background: '#fff', padding: '0.5rem', borderRadius: '0.25rem', wordBreak: 'break-all', textAlign: 'left', whiteSpace: 'pre-wrap' }}>
            {this.state.componentStack}
          </p>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '0.6rem 1.25rem',
            borderRadius: '0.5rem',
            border: 'none',
            background: '#EBA584',
            color: '#3A3A3A',
            fontSize: '0.95rem',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
