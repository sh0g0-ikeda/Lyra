import { Alert } from 'react-native';

import type { UiLanguage } from '@/domain/types';
import type { DirtyStateChoice } from '@/domain/dirtyStatePolicy';
import { t } from '@/lib/i18n';

interface ConfirmDestructiveActionParams {
  language: UiLanguage;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

interface ConfirmActionParams {
  language: UiLanguage;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}

export const confirmDestructiveAction = ({
  language,
  title,
  message,
  confirmLabel,
  onConfirm
}: ConfirmDestructiveActionParams): void => {
  Alert.alert(
    title,
    message,
    [
      { text: t(language, "generated.lib.confirm.cancel.3672b0b9"), style: 'cancel' },
      { text: confirmLabel ?? t(language, "generated.lib.confirm.delete.8deafb71"), style: 'destructive', onPress: onConfirm }
    ],
    { cancelable: true }
  );
};

export const confirmAction = ({
  language,
  title,
  message,
  confirmLabel,
  onConfirm,
  destructive = false
}: ConfirmActionParams): void => {
  Alert.alert(
    title,
    message,
    [
      { text: t(language, "generated.lib.confirm.cancel.3672b0b9"), style: 'cancel' },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm }
    ],
    { cancelable: true }
  );
};

export const confirmUnsavedChange = ({
  language,
  onConfirm
}: {
  language: UiLanguage;
  onConfirm: () => void;
}): void => {
  confirmAction({
    language,
    title: t(language, "generated.lib.confirm.unsaved.changes.4947a834"),
    message: t(language, "generated.lib.confirm.unsaved.edits.will.be.lost.when.switchin.2341a5d5"),
    confirmLabel: t(language, "generated.lib.confirm.switch.eb478b7a"),
    destructive: true,
    onConfirm
  });
};

export function requestUnsavedChangesResolution({
  language
}: {
  language: UiLanguage;
}): Promise<DirtyStateChoice> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (choice: DirtyStateChoice): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(choice);
    };
    Alert.alert(
      t(language, "generated.lib.confirm.unsaved.changes.4947a834"),
      t(language, "generated.lib.confirm.save.or.discard.your.edits.before.leavin.764f7978"),
      [
        {
          text: t(language, "generated.lib.confirm.cancel.3672b0b9"),
          style: 'cancel',
          onPress: () => settle('cancel')
        },
        {
          text: t(language, "generated.lib.confirm.discard.bd94165e"),
          style: 'destructive',
          onPress: () => settle('discard')
        },
        {
          text: t(language, "generated.lib.confirm.save.80b89d5e"),
          onPress: () => settle('save')
        }
      ],
      {
        cancelable: true,
        onDismiss: () => settle('cancel')
      }
    );
  });
}
