import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 렌더 중 예외가 나도 흰 화면 대신 안내·새로고침을 보여준다. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 콘솔에 남겨 원인 파악에 사용
    console.error('UI 렌더 오류:', error, info);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-6 text-center">
          <p className="text-4xl">⚠️</p>
          <div>
            <p className="text-base font-semibold text-gray-900">화면을 불러오지 못했습니다</p>
            <p className="mt-1 text-sm text-gray-500">일시적인 오류입니다. 새로고침해 주세요.</p>
          </div>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            새로고침
          </button>
          {import.meta.env.DEV && (
            <pre className="mt-2 max-w-lg overflow-auto rounded bg-gray-100 p-3 text-left text-xs text-red-600">
              {this.state.error.message}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
