import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { AssetQuoteTarget } from '@/domain/assetGenerationQuote';
import type { GenerationQuoteSnapshot } from '@/domain/generationQuoteController';
import type { UiLanguage } from '@/domain/types';
import { assetQuoteMessages, assetQuoteMessage } from '@/lib/assetQuoteMessages';
import { appendAiProviderDisclosure } from '@/lib/aiProviderDisclosure';
import { t } from '@/lib/i18n';
export function AssetGenerationQuoteDialog({ state, language, canAccept, onAccept, onClose, onReconcile, onRequote }: {
  state: GenerationQuoteSnapshot<AssetQuoteTarget>; language: UiLanguage; canAccept: boolean;
  onAccept: () => void; onClose: () => void; onReconcile: () => void; onRequote: () => void;
}): React.JSX.Element {
  const copy = assetQuoteMessages(language); const quote = state.quote;
  const message = ['quoting', 'accepting', 'unknown', 'stale', 'blocked', 'error', 'unavailable'].includes(state.phase) ? copy[state.phase as 'quoting'] : null;
  return <Modal visible={state.visible} onRequestClose={onClose} animationType="slide" presentationStyle="pageSheet">
    <SafeAreaProvider><SafeAreaView style={styles.root} edges={['top', 'bottom']}><View accessibilityViewIsModal onAccessibilityEscape={onClose} style={styles.root}>
      <View style={styles.header}><Text accessibilityRole="header" style={textStyles.title}>{copy.title}</Text><PrimaryButton label={copy.close} onPress={onClose} variant="ghost" testID="asset-quote-close" /></View>
      <ScrollView contentContainerStyle={styles.body}>
        {state.target === null ? null : <><Text style={textStyles.title}>{state.target.label}</Text><Text style={textStyles.body}>{copy[state.target.request.operation]}</Text></>}
        {message === null ? null : <Text style={textStyles.body}>{message}</Text>}
        {quote === null ? null : <>
          <Text style={textStyles.title}>{assetQuoteMessage(language, 'cost', { amount: quote.amount_credits })}</Text>
          <Text style={textStyles.body}>{copy[quote.billing_scope.kind]}</Text>
          {quote.image_model === null ? null : <Text style={textStyles.body}>{quote.image_model} · {quote.quality} · {quote.render_style === null ? '' : copy[quote.render_style]}</Text>}
          <Text style={textStyles.body}>{assetQuoteMessage(language, 'references', { count: quote.reference_count })}</Text>
          <Text style={textStyles.caption}>{assetQuoteMessage(language, 'expiry', { date: new Date(quote.expires_at).toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US') })}</Text>
        </>}
        <Text style={textStyles.caption}>{appendAiProviderDisclosure(copy.beforeAccept, language, state.target?.request.operation === 'entity_import_analysis' ? 'image' : 'text')}</Text>
        {state.target?.request.operation === 'entity_import_analysis' ? null : <Text style={textStyles.caption}>{t(language, 'component.jobStatusCard.imageDurationEstimate')}</Text>}
      </ScrollView>
      <View style={styles.header}>
        {['review', 'unknown', 'accepting'].includes(state.phase) ? <PrimaryButton label={copy.confirm} disabled={!canAccept} loading={state.phase === 'accepting'} onPress={onAccept} testID="asset-quote-accept" /> : null}
        {state.phase === 'unknown' ? <PrimaryButton label={copy.reconcile} onPress={onReconcile} variant="secondary" testID="asset-quote-reconcile" /> : null}
        {['stale', 'error', 'blocked'].includes(state.phase) ? <PrimaryButton label={copy.refresh} onPress={onRequote} variant="secondary" testID="asset-quote-refresh" /> : null}
      </View>
    </View></SafeAreaView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.canvas }, header: { padding: spacing.md, gap: spacing.sm }, body: { padding: spacing.md, gap: spacing.md } });
