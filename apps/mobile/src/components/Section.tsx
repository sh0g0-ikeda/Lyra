import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadow, spacing, textStyles } from '@/constants/theme';
import { loadSectionCollapsed, saveSectionCollapsed } from '@/lib/storage';

interface SectionProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  tone?: 'default' | 'highlight' | 'subtle' | 'raised';
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  mobileDefaultCollapsed?: boolean;
  showSubtitleWhenCollapsed?: boolean;
  persistKey?: string;
}

export function Section({
  title,
  subtitle,
  action,
  tone = 'default',
  collapsible = false,
  defaultCollapsed = false,
  mobileDefaultCollapsed = false,
  showSubtitleWhenCollapsed = false,
  persistKey,
  children
}: SectionProps): React.JSX.Element {
  const initialCollapsed = defaultCollapsed || mobileDefaultCollapsed;
  const resetKey = `${title}:${String(defaultCollapsed)}:${String(mobileDefaultCollapsed)}`;
  const resetKeyRef = useRef(resetKey);
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  useEffect(() => {
    if (resetKeyRef.current === resetKey) {
      return;
    }

    resetKeyRef.current = resetKey;
    setCollapsed(initialCollapsed);
  }, [initialCollapsed, resetKey]);

  useEffect(() => {
    if (persistKey === undefined) {
      return;
    }

    let mounted = true;
    void loadSectionCollapsed(persistKey).then((storedCollapsed) => {
      if (mounted && storedCollapsed !== null) {
        setCollapsed(storedCollapsed);
      }
    });

    return () => {
      mounted = false;
    };
  }, [persistKey]);

  const toggleCollapsed = (): void => {
    setCollapsed((current) => {
      const next = !current;
      if (persistKey !== undefined) {
        void saveSectionCollapsed(persistKey, next);
      }
      return next;
    });
  };

  return (
    <View
      style={[
        styles.section,
        tone === 'highlight' ? styles.highlight : null,
        tone === 'subtle' ? styles.subtle : null,
        tone === 'raised' ? styles.raised : null,
        collapsed ? styles.collapsed : null
      ]}
    >
      <View style={styles.header}>
        {collapsible ? (
          <Pressable
            accessibilityLabel={title}
            accessibilityRole="button"
            accessibilityState={{ expanded: !collapsed }}
            onPress={toggleCollapsed}
            style={styles.toggle}
          >
            <View style={styles.headingCopy}>
              <Text
                accessibilityRole="header"
                style={[
                  styles.title,
                  tone === 'highlight' ? styles.highlightTitle : null,
                  tone === 'raised' ? styles.raisedTitle : null
                ]}
              >
                {title}
              </Text>
              {subtitle === undefined || (collapsed && !showSubtitleWhenCollapsed)
                ? null
                : (
                    <Text
                      style={[
                        styles.subtitle,
                        tone === 'raised' ? styles.raisedSubtitle : null
                      ]}
                    >
                      {subtitle}
                    </Text>
                  )}
            </View>
            <Text style={styles.chevron}>{collapsed ? 'v' : '^'}</Text>
          </Pressable>
        ) : (
          <View style={styles.headingCopy}>
            <Text
              accessibilityRole="header"
              style={[
                styles.title,
                tone === 'highlight' ? styles.highlightTitle : null,
                tone === 'raised' ? styles.raisedTitle : null
              ]}
            >
              {title}
            </Text>
            {subtitle === undefined ? null : (
              <Text
                style={[
                  styles.subtitle,
                  tone === 'raised' ? styles.raisedSubtitle : null
                ]}
              >
                {subtitle}
              </Text>
            )}
          </View>
        )}
        {action}
      </View>
      {collapsed ? null : <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md
  },
  chevron: {
    color: colors.primary,
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 24,
    minWidth: 22,
    textAlign: 'center'
  },
  collapsed: {
    gap: 0
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 34
  },
  headingCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  highlight: {
    backgroundColor: 'rgba(26, 26, 26, 0.94)',
    borderColor: 'rgba(229, 199, 107, 0.28)',
    borderLeftColor: colors.primary,
    borderLeftWidth: 3
  },
  highlightTitle: {
    color: '#F3DC87'
  },
  raised: {
    backgroundColor: colors.editorSurface,
    borderColor: colors.editorBorder
  },
  raisedSubtitle: {
    color: colors.editorMuted
  },
  raisedTitle: {
    color: colors.editorText
  },
  section: {
    ...shadow,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md
  },
  subtle: {
    backgroundColor: 'rgba(20, 20, 20, 0.72)',
    shadowOpacity: 0
  },
  subtitle: {
    ...textStyles.caption,
    color: colors.muted
  },
  title: {
    ...textStyles.sectionTitle,
    flex: 1
  },
  toggle: {
    alignItems: 'flex-start',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    minWidth: 0
  }
});
