import { useEffect, useRef, type PropsWithChildren, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { t } from '@/lib/i18n';

interface OrganizationManagementModalProps extends PropsWithChildren {
  language: 'ja' | 'en';
  onClose: () => void;
  restoreFocusRef?: RefObject<View | null>;
  visible: boolean;
}

export function OrganizationManagementModal({
  children,
  language,
  onClose,
  restoreFocusRef,
  visible
}: OrganizationManagementModalProps): React.JSX.Element {
  const wasVisibleRef = useRef(visible);

  useEffect(() => {
    if (!visible && wasVisibleRef.current && restoreFocusRef !== undefined) {
      const triggerNode = findNodeHandle(restoreFocusRef.current);
      if (triggerNode !== null) {
        AccessibilityInfo.setAccessibilityFocus(triggerNode);
      }
    }
    wasVisibleRef.current = visible;
  }, [restoreFocusRef, visible]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={visible}
    >
      {visible ? (
        <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={{ flex: 1 }}>
          <Screen
            subtitle={t(language, "generated.components.OrganizationManagementModal.manage.members.billing.and.usage.on.this.109062a0")}
            title={t(language, "generated.components.OrganizationManagementModal.organization.management.23edc1a9")}
          >
            <PrimaryButton
              label={t(language, "generated.components.OrganizationManagementModal.close.603bc62f")}
              onPress={onClose}
              variant="secondary"
            />
            {children}
          </Screen>
        </View>
      ) : null}
    </Modal>
  );
}
