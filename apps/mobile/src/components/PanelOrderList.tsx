import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowDown,
  ArrowUp,
  Check,
  MoreHorizontal,
  Pencil,
  Trash2,
  X
} from 'lucide-react-native';

import { panelRoleOptions } from '@/constants/options';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { PanelRecord } from '@/domain/types';
import { t } from '@/lib/i18n';
import type { ComponentTranslationKey } from '@/lib/i18nComponentMessages';

interface PanelOrderListProps {
  disabled?: boolean;
  language: 'ja' | 'en';
  onChangeRole: (panelId: string, role: PanelRecord['panel_role']) => void;
  onDelete: (panel: PanelRecord) => void;
  onInsertAfter?: (panelId: string) => void;
  insertAfterDisabledReason?: string;
  onMove: (panelId: string, direction: 'up' | 'down') => void;
  onSelect: (panelId: string) => void;
  panels: readonly PanelRecord[];
  selectedPanelId: string | null;
}

const roleLabel = (role: PanelRecord['panel_role'], language: 'ja' | 'en'): string => {
  const key = panelRoleTranslationKey(role);
  return key === null ? role : t(language, key);
};

const panelRoleTranslationKey = (role: PanelRecord['panel_role']): ComponentTranslationKey | null => {
  const keys: Record<PanelRecord['panel_role'], ComponentTranslationKey> = {
    establish: 'component.panelRole.establish',
    action: 'component.panelRole.action',
    reaction: 'component.panelRole.reaction',
    emphasis: 'component.panelRole.emphasis',
    transition: 'component.panelRole.transition',
    pause: 'component.panelRole.pause',
    impact: 'component.panelRole.impact'
  };
  return keys[role] ?? null;
};

const situationSummary = (panel: PanelRecord, language: 'ja' | 'en'): string => {
  const value = panel.situation_text?.trim() ?? '';
  if (value.length === 0) {
    return t(language, "generated.components.PanelOrderList.no.situation.fbfa2c4d");
  }
  return value.length > 64 ? `${value.slice(0, 64)}...` : value;
};

export function PanelOrderList({
  disabled = false,
  language,
  onChangeRole,
  onDelete,
  onInsertAfter,
  onMove,
  onSelect,
  panels,
  selectedPanelId,
  insertAfterDisabledReason
}: PanelOrderListProps): React.JSX.Element {
  const safeAreaInsets = useSafeAreaInsets();
  const sortedPanels = useMemo(
    () => [...panels].sort((left, right) => left.order - right.order),
    [panels]
  );
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState<'actions' | 'role'>('actions');
  const menuTriggerRefs = useRef(new Map<string, View | null>());
  const restoreMenuTriggerIdRef = useRef<string | null>(null);
  const activePanel = sortedPanels.find((panel) => panel.id === activePanelId) ?? null;
  const activeIndex = activePanel === null
    ? -1
    : sortedPanels.findIndex((panel) => panel.id === activePanel.id);

  const closeMenu = (): void => {
    if (activePanelId !== null) {
      restoreMenuTriggerIdRef.current = activePanelId;
    }
    setActivePanelId(null);
    setMenuMode('actions');
  };

  useEffect(() => {
    if (activePanelId !== null || restoreMenuTriggerIdRef.current === null) {
      return;
    }

    const triggerNode = findNodeHandle(menuTriggerRefs.current.get(restoreMenuTriggerIdRef.current) ?? null);
    if (triggerNode !== null) {
      AccessibilityInfo.setAccessibilityFocus(triggerNode);
    }
    restoreMenuTriggerIdRef.current = null;
  }, [activePanelId]);

  const openMenu = (panelId: string): void => {
    setActivePanelId(panelId);
    setMenuMode('actions');
  };

  const move = (direction: 'up' | 'down'): void => {
    if (activePanel === null) {
      return;
    }
    onMove(activePanel.id, direction);
    closeMenu();
  };

  const changeRole = (role: PanelRecord['panel_role']): void => {
    if (activePanel === null) {
      return;
    }
    onChangeRole(activePanel.id, role);
    closeMenu();
  };

  const remove = (): void => {
    if (activePanel === null) {
      return;
    }
    const panel = activePanel;
    closeMenu();
    onDelete(panel);
  };

  const insertAfter = (): void => {
    if (activePanel === null || onInsertAfter === undefined || activePanel.id !== selectedPanelId) {
      return;
    }
    closeMenu();
    onInsertAfter(activePanel.id);
  };

  if (sortedPanels.length === 0) {
    return (
      <Text style={styles.empty}>
        {t(language, "generated.components.PanelOrderList.no.panels.yet.2ea9140d")}
      </Text>
    );
  }

  return (
    <>
      <Text style={styles.pickerLabel}>{t(language, 'component.panelOrderList.pickerLabel')}</Text>
      <View style={styles.list}>
        {sortedPanels.map((panel) => {
          const selected = panel.id === selectedPanelId;
          return (
            <View key={panel.id} style={[styles.row, selected ? styles.rowSelected : null]}>
              <Pressable
                accessibilityLabel={t(language, 'component.panelOrderList.editPanel', { order: panel.order })}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => onSelect(panel.id)}
                style={styles.rowMain}
              >
                <View style={[styles.orderBadge, selected ? styles.orderBadgeSelected : null]}>
                  <Text style={[styles.orderText, selected ? styles.orderTextSelected : null]}>{panel.order}</Text>
                </View>
                <View style={styles.rowCopy}>
                  <View style={styles.rowHeading}>
                    <Text numberOfLines={1} style={[styles.rowTitle, selected ? styles.selectedText : null]}>
                      {t(language, 'component.panelOrderList.panelTitle', { order: panel.order })}
                    </Text>
                    <Text numberOfLines={1} style={[styles.role, selected ? styles.selectedText : null]}>
                      {roleLabel(panel.panel_role, language)}
                    </Text>
                  </View>
                </View>
              </Pressable>
              <Pressable
                accessibilityLabel={t(language, 'component.panelOrderList.panelActions', { order: panel.order })}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                hitSlop={8}
                onPress={() => openMenu(panel.id)}
                ref={(node: View | null): void => {
                  menuTriggerRefs.current.set(panel.id, node);
                }}
                style={styles.moreButton}
              >
                <MoreHorizontal color={selected ? colors.primaryText : colors.ink} size={22} strokeWidth={2} />
              </Pressable>
            </View>
          );
        })}
      </View>

      <Modal animationType="fade" onRequestClose={closeMenu} transparent visible={activePanel !== null}>
        <Pressable accessibilityRole="button" onPress={closeMenu} style={styles.backdrop}>
          <View
            accessibilityViewIsModal
            onAccessibilityEscape={closeMenu}
            onStartShouldSetResponder={() => true}
            style={styles.sheet}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text style={styles.sheetTitle}>
                  {activePanel === null
                    ? ''
                    : t(language, 'component.panelOrderList.panelTitle', { order: activePanel.order })}
                </Text>
                {activePanel === null ? null : (
                  <Text numberOfLines={1} style={styles.sheetSubtitle}>
                    {situationSummary(activePanel, language)}
                  </Text>
                )}
              </View>
              <Pressable
                accessibilityLabel={t(language, "generated.components.PanelOrderList.close.603bc62f")}
                accessibilityRole="button"
                onPress={closeMenu}
                style={styles.closeButton}
              >
                <X color={colors.ink} size={22} strokeWidth={2} />
              </Pressable>
            </View>

            {menuMode === 'actions' ? (
              <View style={[styles.actionList, { paddingBottom: spacing.sm + safeAreaInsets.bottom }]}>
                <MenuAction
                  accessibilityLabel={t(language, "generated.components.PanelOrderList.move.earlier.749347cc")}
                  disabled={disabled || activeIndex <= 0}
                  icon={<ArrowUp color={colors.ink} size={20} strokeWidth={2} />}
                  label={t(language, "generated.components.PanelOrderList.move.earlier.749347cc")}
                  onPress={() => move('up')}
                />
                <MenuAction
                  accessibilityLabel={t(language, "generated.components.PanelOrderList.move.later.acef19e8")}
                  disabled={disabled || activeIndex < 0 || activeIndex >= sortedPanels.length - 1}
                  icon={<ArrowDown color={colors.ink} size={20} strokeWidth={2} />}
                  label={t(language, "generated.components.PanelOrderList.move.later.acef19e8")}
                  onPress={() => move('down')}
                />
                <MenuAction
                  accessibilityLabel={t(language, "generated.components.PanelOrderList.change.role.0f65f24c")}
                  disabled={disabled}
                  icon={<Pencil color={colors.ink} size={20} strokeWidth={2} />}
                  label={t(language, "generated.components.PanelOrderList.change.role.0f65f24c")}
                  onPress={() => setMenuMode('role')}
                />
                {activePanel?.id === selectedPanelId ? (
                  <MenuAction
                    accessibilityHint={insertAfterDisabledReason}
                    accessibilityLabel={t(language, 'component.panelOrderList.insertAfter')}
                    disabled={disabled || onInsertAfter === undefined || insertAfterDisabledReason !== undefined}
                    icon={<Pencil color={colors.ink} size={20} strokeWidth={2} />}
                    label={t(language, 'component.panelOrderList.insertAfter')}
                    onPress={insertAfter}
                  />
                ) : null}
                <MenuAction
                  accessibilityLabel={t(language, "generated.components.PanelOrderList.delete.panel.5c663bc3")}
                  danger
                  disabled={disabled}
                  icon={<Trash2 color={colors.danger} size={20} strokeWidth={2} />}
                  label={t(language, "generated.components.PanelOrderList.delete.panel.5c663bc3")}
                  onPress={remove}
                />
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.roleList}>
                <Text style={styles.rolePrompt}>
                  {t(language, "generated.components.PanelOrderList.choose.panel.role.2565d6f5")}
                </Text>
                {panelRoleOptions.map((option) => {
                  const selected = option.value === activePanel?.panel_role;
                  const label = roleLabel(option.value, language);
                  return (
                    <Pressable
                      accessibilityLabel={label}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled }}
                      disabled={disabled}
                      key={option.value}
                      onPress={() => changeRole(option.value)}
                      style={[styles.roleOption, selected ? styles.roleOptionSelected : null]}
                    >
                      <View style={[styles.radio, selected ? styles.radioSelected : null]}>
                        {selected ? <Check color={colors.primaryText} size={14} strokeWidth={3} /> : null}
                      </View>
                      <Text style={styles.roleOptionText}>{label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

interface MenuActionProps {
  accessibilityHint?: string;
  accessibilityLabel: string;
  danger?: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}

function MenuAction({
  accessibilityHint,
  accessibilityLabel,
  danger = false,
  disabled,
  icon,
  label,
  onPress
}: MenuActionProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, danger ? styles.actionDanger : null, disabled ? styles.disabled : null]}
    >
      {icon}
      <Text style={[styles.actionText, danger ? styles.actionTextDanger : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  actionDanger: {
    backgroundColor: colors.dangerSurface
  },
  actionList: {
    gap: 0
  },
  actionText: {
    ...textStyles.body,
    color: colors.inkStrong,
    flex: 1,
    fontWeight: '600'
  },
  actionTextDanger: {
    color: colors.danger
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.md
  },
  closeButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  disabled: {
    opacity: 0.38
  },
  empty: {
    ...textStyles.caption
  },
  list: {
    gap: spacing.sm
  },
  moreButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    minHeight: 52,
    width: 48
  },
  orderBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    height: 34,
    justifyContent: 'center',
    width: 34
  },
  orderText: {
    color: colors.primaryText,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0
  },
  orderBadgeSelected: {
    backgroundColor: colors.primaryText
  },
  orderTextSelected: {
    color: colors.primary
  },
  pickerLabel: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
  radio: {
    alignItems: 'center',
    borderColor: colors.borderStrong,
    borderRadius: 10,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20
  },
  radioSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  role: {
    ...textStyles.caption,
    color: colors.primary,
    flexShrink: 0,
    fontWeight: '700'
  },
  roleList: {
    gap: spacing.xs,
    paddingBottom: spacing.sm
  },
  roleOption: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  roleOptionSelected: {
    backgroundColor: colors.warningSurface
  },
  roleOptionText: {
    ...textStyles.body,
    color: colors.inkStrong,
    fontWeight: '600'
  },
  rolePrompt: {
    ...textStyles.caption,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.field,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    overflow: 'hidden'
  },
  rowCopy: {
    flex: 1,
    minWidth: 0
  },
  rowHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm
  },
  rowMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 54,
    minWidth: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  rowSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  selectedText: {
    color: colors.primaryText
  },
  rowTitle: {
    ...textStyles.body,
    color: colors.inkStrong,
    flex: 1,
    fontWeight: '700'
  },
  sheet: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    maxHeight: '78%',
    overflow: 'hidden'
  },
  sheetHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingLeft: spacing.md
  },
  sheetHeaderCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
    paddingVertical: spacing.md
  },
  sheetSubtitle: {
    ...textStyles.caption
  },
  sheetTitle: {
    ...textStyles.sectionTitle
  },
});
