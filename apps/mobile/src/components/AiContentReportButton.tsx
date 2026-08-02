import { useState } from 'react';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import type { UiLanguage } from '@/domain/types';
import { confirmAction } from '@/lib/confirm';
import { t } from '@/lib/i18n';
import type { AiContentReportKind } from '@/lib/api';
import { useAppState } from '@/state/appState';

interface AiContentReportButtonProps {
  contentId?: string | null;
  contentKind: AiContentReportKind;
  language: UiLanguage;
  onReport?: () => void;
}

export function AiContentReportButton({
  contentKind,
  contentId,
  language,
  onReport
}: AiContentReportButtonProps): React.JSX.Element {
  const { api } = useAppState();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const report = (): void => {
    confirmAction({
      language,
      title: t(language, 'component.aiContentReport.title'),
      message: t(language, 'component.aiContentReport.message'),
      confirmLabel: t(language, 'component.aiContentReport.confirm'),
      onConfirm: () => {
        onReport?.();
        setStatus('sending');
        void api.submitAiContentReport(contentKind, contentId)
          .then(() => setStatus('sent'))
          .catch(() => setStatus('failed'));
      }
    });
  };

  return (
    <>
      <PrimaryButton
        disabled={status === 'sending'}
        label={t(language, 'component.aiContentReport.action')}
        loading={status === 'sending'}
        onPress={report}
        variant="ghost"
      />
      {status === 'sent' ? (
        <Notice message={t(language, 'component.aiContentReport.sent')} tone="info" />
      ) : null}
      {status === 'failed' ? (
        <Notice message={t(language, 'component.aiContentReport.failed')} tone="warning" />
      ) : null}
    </>
  );
}
