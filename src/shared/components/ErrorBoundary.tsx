import React, { Component, ErrorInfo, ReactNode } from "react";
import "../../portal/src/styles/ErrorBoundary.css";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary-container">
          <h2 className="error-boundary-title">Oops, something went wrong.</h2>
          <p className="error-boundary-text">
            The application encountered an unexpected error.
          </p>
          <button
            onClick={() => globalThis.location.reload()}
            className="error-boundary-reload-btn"
          >
            Reload Page
          </button>
          {this.state.error && (
            <pre className="error-boundary-pre">
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
