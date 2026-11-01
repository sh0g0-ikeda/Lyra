import { useEffect, useRef, useState } from 'react';

import {
  readMangaTutorialHistory,
  writeMangaTutorialHistory,
} from '../lib/mangaTutorialHistory';

type TutorialLanguage = 'ja' | 'en';

export interface WebMangaTutorialProps {
  language: TutorialLanguage;
  storageScope: string;
  autoOpen: boolean;
  canAutoOpen?: () => boolean;
  credits: number | null;
}

type TutorialCopy = {
  back: string;
  close: string;
  credits: string;
  done: string;
  historyError: string;
  next: string;
  replay: string;
  skip: string;
  step: string;
  title: string;
  steps: readonly { title: string; body: string }[];
};

const tutorialCopy: Record<TutorialLanguage, TutorialCopy> = {
  ja: {
    title: 'Lyraへようこそ', replay: 'チュートリアルを見る', close: 'チュートリアルを閉じる',
    credits: 'クレジット', skip: 'スキップ', back: '戻る', next: '次へ', done: '完了', step: 'ステップ',
    historyError: 'チュートリアルの閲覧状況を保存できませんでした。いつでも見直せます。',
    steps: [
      { title: '1. ストーリー', body: '漫画一覧から作品・章・話を作成または選択します。話のタイトル・本文・想定ページ数を保存します。' },
      { title: '2. キャラクター', body: '作品で使うキャラクターや素材を作成または選択し、設定とキャラ画像を確認します。アセットは読書用タブです。' },
      { title: '3. ページ', body: '「ページを設計してストーリーから自動入力」で、ページ骨格の作成とコマ設定の自動入力を一度に行います。結果を確認してからページ画像を生成します。工程を移動するだけでは保存も生成も行いません。' },
      { title: 'クレジットと見直し', body: 'ヘッダーで個人または組織の残高を確認します。画像生成・プレビュー・取り込みはクレジットを使います。マイページで課金設定と言語を確認できます。' },
    ],
  },
  en: {
    title: 'Welcome to Lyra', replay: 'View tutorial', close: 'Close tutorial',
    credits: 'Credits', skip: 'Skip tutorial', back: 'Back', next: 'Next', done: 'Done', step: 'Step',
    historyError: 'Tutorial progress could not be saved. You can replay it at any time.',
    steps: [
      { title: '1. Story', body: 'From the Manga library, create or select a work, chapter, and episode. Save its title, story, and planned page count.' },
      { title: '2. Characters', body: 'Create or select characters and materials for the work, then review their settings and images. Assets is the reader tab.' },
      { title: '3. Pages', body: 'Use Design pages and autofill from story to create the page plan and fill panel settings in one action. Review the result before generating page images. Moving between steps never saves or generates.' },
      { title: 'Credits and replay', body: 'The header shows the active personal or organization balance. Generation, previews, and imports use credits. My Page contains billing and language settings.' },
    ],
  },
};

function readLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function WebMangaTutorial({ autoOpen, canAutoOpen, credits, language, storageScope }: WebMangaTutorialProps): React.JSX.Element {
  const copy = tutorialCopy[language];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const stepTitleRef = useRef<HTMLHeadingElement>(null);
  const suppressClosePersistence = useRef(false);
  const autoOpenAttempted = useRef<string | null>(null);
  const previousAutoOpen = useRef(autoOpen);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [historyError, setHistoryError] = useState(false);

  const closeWithoutPersisting = (): void => {
    suppressClosePersistence.current = true;
    setOpen(false);
  };

  const finish = (): void => {
    const storage = readLocalStorage();
    if (storage === null || !writeMangaTutorialHistory(storage, storageScope)) setHistoryError(true);
    closeWithoutPersisting();
  };

  const replay = (): void => {
    suppressClosePersistence.current = false;
    setStep(0);
    setOpen(true);
  };

  useEffect(() => {
    const wasAutoOpen = previousAutoOpen.current;
    previousAutoOpen.current = autoOpen;
    if (wasAutoOpen && !autoOpen) closeWithoutPersisting();
  }, [autoOpen]);

  useEffect(() => {
    if (!autoOpen || autoOpenAttempted.current === storageScope) return;
    const attemptAutoOpen = (): void => {
      if (document.visibilityState !== 'visible' || autoOpenAttempted.current === storageScope) return;
      if (canAutoOpen?.() === false) return;
      autoOpenAttempted.current = storageScope;
      const storage = readLocalStorage();
      const history = storage === null ? 'unavailable' : readMangaTutorialHistory(storage, storageScope);
      if (history === 'unavailable') setHistoryError(true);
      if (history === 'unseen' || history === 'unavailable') {
        setStep(0);
        setOpen(true);
      }
    };
    attemptAutoOpen();
    document.addEventListener('visibilitychange', attemptAutoOpen);
    return () => document.removeEventListener('visibilitychange', attemptAutoOpen);
  }, [autoOpen, canAutoOpen, storageScope]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        setHistoryError(true);
      }
      return;
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (open) stepTitleRef.current?.focus();
  }, [open, step]);

  const onDialogClose = (): void => {
    const shouldPersist = !suppressClosePersistence.current;
    suppressClosePersistence.current = false;
    setOpen(false);
    const storage = readLocalStorage();
    if (shouldPersist && (storage === null || !writeMangaTutorialHistory(storage, storageScope))) setHistoryError(true);
    triggerRef.current?.focus();
  };

  const currentStep = copy.steps[step];
  return (
    <div className="web-manga-tutorial">
      <button className="web-manga-tutorial-replay" onClick={replay} ref={triggerRef} type="button">
        {copy.replay}
      </button>
      {historyError ? <p className="web-manga-tutorial-warning" role="status">{copy.historyError}</p> : null}
      <dialog aria-labelledby="web-manga-tutorial-title" className="web-manga-tutorial-dialog" onClose={onDialogClose} ref={dialogRef}>
        <header className="web-manga-tutorial-header">
          <h2 id="web-manga-tutorial-title">{copy.title}</h2>
          <button aria-label={copy.close} className="web-manga-tutorial-close" onClick={finish} type="button">×</button>
        </header>
        <p className="web-manga-tutorial-credits">{copy.credits}: {credits === null ? '—' : credits}</p>
        <div className="web-manga-tutorial-body">
          <p>{copy.step} {step + 1} / {copy.steps.length}</p>
          <h3 ref={stepTitleRef} tabIndex={-1}>{currentStep.title}</h3>
          <p>{currentStep.body}</p>
        </div>
        <footer className="web-manga-tutorial-actions">
          <button onClick={finish} type="button">{copy.skip}</button>
          {step > 0 ? <button onClick={() => setStep((value) => value - 1)} type="button">{copy.back}</button> : null}
          {step === copy.steps.length - 1
            ? <button onClick={finish} type="button">{copy.done}</button>
            : <button onClick={() => setStep((value) => value + 1)} type="button">{copy.next}</button>}
        </footer>
      </dialog>
    </div>
  );
}
