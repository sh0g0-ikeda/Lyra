import { StyleSheet, View } from 'react-native';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { spacing } from '@/constants/theme';
import { t } from '@/lib/i18n';

interface PanelDialoguePlacementNoticeProps {
  dialogueInPanel: boolean;
  language: 'ja' | 'en';
  onOpenWeb: () => void;
}

export function PanelDialoguePlacementNotice({
  dialogueInPanel,
  language,
  onOpenWeb
}: PanelDialoguePlacementNoticeProps): React.JSX.Element | null {
  // Keep the exceptional outside-art warning/action; the normal state needs no prose.
  if (dialogueInPanel) return null;

  return (
    <View style={styles.container}>
      <Notice
        message={t(language, "generated.components.PanelDialoguePlacementNotice.this.panel.has.an.existing.outside.art.d.dd6bb5e0")}
        tone="warning"
      />
      <PrimaryButton
        label={t(language, "generated.components.PanelDialoguePlacementNotice.edit.on.web.80c19bed")}
        onPress={onOpenWeb}
        variant="secondary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm
  }
});
