import React from 'react';

interface State { error: Error | null; info: React.ErrorInfo | null }

/**
 * Top-level error boundary.
 *
 * Without this, any uncaught render error in React 18 silently unmounts the
 * entire component tree, leaving only the dark body background — the "blank
 * dark screen" symptom.  This boundary catches the error, logs the component
 * stack to the console (forwarded to the main-process log via
 * wc.on('console-message')), and renders a minimal recovery UI instead.
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // console.error is picked up by wc.on('console-message') in main.js and
    // written to %TEMP%\sadik_app_tracker.log for offline inspection.
    console.error(
      '[SADIK][ErrorBoundary] Uncaught render error:',
      error.message,
      '\nComponent stack:',
      info.componentStack,
      '\nFull error:',
      error.stack,
    );
    this.setState({ info });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          background: '#0a0f1a',
          color: '#e2e8f0',
          padding: '32px',
          fontFamily: 'monospace',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          maxWidth: '640px',
          margin: '0 auto',
        }}>
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '8px', fontWeight: 'bold' }}>
            SADIK — render hatası (boş ekran engellendi)
          </p>
          <p style={{ color: '#9ca3af', fontSize: '12px', marginBottom: '16px' }}>
            {this.state.error.message}
          </p>
          {this.state.info && (
            <pre style={{
              color: '#4b5563',
              fontSize: '10px',
              whiteSpace: 'pre-wrap',
              overflowY: 'auto',
              maxHeight: '200px',
              marginBottom: '16px',
            }}>
              {this.state.info.componentStack}
            </pre>
          )}
          <button
            onClick={() => this.setState({ error: null, info: null })}
            style={{
              alignSelf: 'flex-start',
              padding: '8px 16px',
              background: '#1e2a4a',
              color: '#e2e8f0',
              border: '1px solid #2a3a5a',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Yeniden Dene
          </button>
          <p style={{ color: '#374151', fontSize: '10px', marginTop: '12px' }}>
            Hata ayrıntıları: %TEMP%\sadik_app_tracker.log
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
