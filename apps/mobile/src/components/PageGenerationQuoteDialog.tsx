import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { PageQuoteSnapshot } from '@/domain/pageGenerationQuoteController';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';
import { pageWorkflowMessage as message } from '@/lib/pageWorkflowMessages';

export function PageGenerationQuoteDialog({ state, language, canAccept, onAccept, onClose, onReconcile, onRequote }: {
  state: PageQuoteSnapshot; language: UiLanguage; canAccept: boolean;
  onAccept: () => void; onClose: () => void; onReconcile: () => void; onRequote: () => void;
}): React.JSX.Element {
  const busy = state.phase === 'quoting' || state.phase === 'accepting';
  const quote = state.quote;
  const phaseMessage = state.phase === 'quoting' ? 'quoteLoading' : state.phase === 'accepting' ? 'quoteAccepting' : state.phase === 'unknown' ? 'quoteUnknown' : state.phase === 'stale' ? 'quoteStale' : state.phase === 'blocked' ? 'quoteBlocked' : state.phase === 'unavailable' ? 'quoteUnavailable' : state.phase === 'error' ? 'quoteError' : null;
  return <Modal visible={state.visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
    <SafeAreaProvider><SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={styles.root}>
        <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{message(language, 'quoteTitle')}</Text><PrimaryButton label={message(language, 'quoteCancel')} onPress={onClose} variant="ghost" testID="page-quote-close" /></View>
        <ScrollView contentContainerStyle={styles.body}>
          {state.target === null ? null : <Text style={styles.title}>{message(language, 'page', { number: state.target.pageNumber })} · {message(language, state.target.renderStyle === 'monochrome' ? 'quoteMonochrome' : 'quoteColor')}</Text>}
          {phaseMessage === null ? null : <Text style={styles.copy}>{message(language, phaseMessage)}</Text>}
          {quote === null ? null : <>
            <Text style={styles.copy}>{message(language, quote.operation === 'page_regenerate' ? 'quoteRegenerate' : 'quoteGenerate')}</Text>
            <Text style={styles.price}>{message(language, 'quoteCost', { amount: quote.amount_credits })}</Text>
            <Text style={styles.copy}>{message(language, quote.billing_scope.kind === 'personal' ? 'quoteScopePersonal' : 'quoteScopeOrganization')}</Text>
            <Text style={styles.copy}>{quote.image_model} · {quote.quality}</Text>
            <Text style={styles.copy}>{message(language, 'quoteReferences', { count: quote.reference_count })}</Text>
            <Text style={styles.copy}>{message(language, 'quoteExpiry', { expiry: new Date(quote.expires_at).toLocaleTimeString(language === 'ja' ? 'ja-JP' : 'en-US') })}</Text>
          </>}
          <Text style={styles.help}>{message(language, 'noAutomaticCharge')}</Text>
          <Text style={styles.help}>{t(language, 'component.jobStatusCard.imageDurationEstimate')}</Text>
        </ScrollView>
        <View style={styles.footer}>
          {state.phase === 'review' || state.phase === 'unknown' || state.phase === 'accepting' ? <PrimaryButton label={message(language, 'quoteConfirm')} disabled={!canAccept || busy} loading={state.phase === 'accepting'} onPress={onAccept} testID="page-quote-accept" /> : null}
          {state.phase === 'unknown' ? <PrimaryButton label={message(language, 'quoteRetry')} onPress={onReconcile} variant="secondary" testID="page-quote-reconcile" /> : null}
          {state.phase === 'stale' || state.phase === 'error' || state.phase === 'blocked' ? <PrimaryButton label={message(language, 'quoteRequote')} onPress={onRequote} variant="secondary" testID="page-quote-refresh" /> : null}
        </View>
      </View>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.canvas }, header: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm }, title: { ...textStyles.title }, body: { padding: spacing.md, gap: spacing.md }, copy: { ...textStyles.body }, help: { ...textStyles.caption }, footer: { padding: spacing.md, gap: spacing.sm }, price: { ...textStyles.title, color: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.sm } });
