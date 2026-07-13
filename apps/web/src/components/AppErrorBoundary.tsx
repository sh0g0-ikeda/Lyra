import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public state: AppErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unexpected web render failure', error, errorInfo);
  }

  public render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const language = window.localStorage.getItem('lyra:web:ui-language') === 'en' ? 'en' : 'ja';
    return (
      <main className="app-error-boundary" role="alert">
        <section>
          <h1>{language === 'en' ? 'The screen could not be displayed' : '画面を表示できませんでした'}</h1>
          <p>
            {language === 'en'
              ? 'Reload the page. Your saved work will not be deleted.'
              : 'ページを再読み込みしてください。保存済みの作品は削除されません。'}
          </p>
          <button className="primary-button" onClick={() => window.location.reload()} type="button">
            {language === 'en' ? 'Reload' : '再読み込み'}
          </button>
        </section>
      </main>
    );
  }
}
