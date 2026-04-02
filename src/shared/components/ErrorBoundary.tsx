import React, { Component, ErrorInfo, ReactNode } from "react";

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
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            background: "#18181b",
            color: "#efeff1",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            fontFamily: "sans-serif",
          }}
        >
          <h2 style={{ color: "#ff4a4a" }}>Oops, something went wrong.</h2>
          <p style={{ color: "#adadb8", maxWidth: "400px", margin: "1rem 0" }}>
            The application encountered an unexpected error.
          </p>
          <button
            onClick={() => globalThis.location.reload()}
            style={{
              background: "#9146ff",
              color: "white",
              border: "none",
              padding: "0.75rem 1.5rem",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Reload Page
          </button>
          {this.state.error && (
            <pre
              style={{
                marginTop: "2rem",
                padding: "1rem",
                background: "#0e0e10",
                borderRadius: "4px",
                fontSize: "0.8rem",
                textAlign: "left",
                overflow: "auto",
                maxWidth: "90vw",
              }}
            >
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
