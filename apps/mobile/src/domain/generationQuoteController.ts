import type { GenerationQuote, GenerationQuoteAcceptance, GenerationQuoteReceipt } from '@/domain/pageGenerationQuote';
export interface GenerationQuoteContext { key: string; organizationId: string | null; enabled: boolean; revision?: string; }
export interface GenerationQuoteDependencies<Target, PreparedTarget extends Target> {
  quoteMatchesTarget: (quote: GenerationQuote, target: PreparedTarget) => boolean;
  prepare: (target: Target) => Promise<PreparedTarget | null>;
  createQuote: (target: PreparedTarget, organizationId: string | null) => Promise<GenerationQuote>;
  acceptQuote: (quoteId: string, input: GenerationQuoteAcceptance, organizationId: string | null) => Promise<GenerationQuoteReceipt>;
  getReceipt: (quoteId: string, organizationId: string | null) => Promise<GenerationQuoteReceipt>;
  requestKey: () => string;
  now: () => number;
  onAccepted: (receipt: GenerationQuoteReceipt, target: PreparedTarget, originKey: string) => void | Promise<void>;
}
export interface GenerationQuoteSnapshot<Target> {
  phase: 'closed' | 'quoting' | 'review' | 'accepting' | 'unknown' | 'stale' | 'blocked' | 'error' | 'unavailable' | 'accepted';
  visible: boolean;
  target: Target | null;
  quote: GenerationQuote | null;
  receipt: GenerationQuoteReceipt | null;
}
interface Attempt<Target, PreparedTarget extends Target> { quote: GenerationQuote; target: PreparedTarget; context: GenerationQuoteContext; requestKey: string | null; dependencies: GenerationQuoteDependencies<Target, PreparedTarget>; }

// A paid request is separate from navigation and quote issuance. Once acceptance
// is uncertain, retain the exact token/key until its receipt is reconciled.
export class GenerationQuoteController<Target, PreparedTarget extends Target> {
  private snapshot: GenerationQuoteSnapshot<Target> = { phase: 'closed', visible: false, target: null, quote: null, receipt: null };
  private readonly listeners = new Set<() => void>();
  private attempt: Attempt<Target, PreparedTarget> | null = null;
  private version = 0;
  private busy = false;
  private active = true;
  public constructor(private dependencies: GenerationQuoteDependencies<Target, PreparedTarget>, private context: GenerationQuoteContext) {}
  public activate(): void { this.active = true; }
  public dispose(): void { this.active = false; this.version += 1; this.set({ visible: false }); }
  public getSnapshot = (): GenerationQuoteSnapshot<Target> => this.snapshot;
  public subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  public updateDependencies(dependencies: GenerationQuoteDependencies<Target, PreparedTarget>): void { this.dependencies = dependencies; }
  public updateContext(context: GenerationQuoteContext): void {
    const changed = this.context.key !== context.key || this.context.enabled !== context.enabled || this.context.organizationId !== context.organizationId || this.context.revision !== context.revision;
    this.context = context;
    if (changed) { this.version += 1; this.set({ visible: false, ...(this.snapshot.phase === 'quoting' ? { phase: 'closed' as const } : {}) }); }
  }
  private set(patch: Partial<GenerationQuoteSnapshot<Target>>): void { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach((listener) => listener()); }
  public canAccept(): boolean {
    return this.active && this.snapshot.visible && !this.busy && this.context.enabled && this.attempt !== null && this.context.key === this.attempt.context.key &&
      ['review', 'unknown'].includes(this.snapshot.phase) && this.attempt.quote.blockers.length === 0 && this.context.revision === this.attempt.context.revision;
  }
  public close(): void {
    if (this.snapshot.phase === 'quoting') { this.version += 1; this.set({ visible: false, phase: 'closed' }); return; }
    this.set({ visible: false });
  }
  public async open(target: Target): Promise<void> {
    if (!this.active || this.busy || this.snapshot.phase === 'quoting') return;
    if (this.snapshot.phase === 'unknown' && this.attempt !== null) { this.set({ visible: this.context.key === this.attempt.context.key }); return; }
    if (!this.context.enabled) { this.set({ visible: true, phase: 'unavailable', target, quote: null, receipt: null }); return; }
    const version = ++this.version;
    const context = { ...this.context };
    const dependencies = this.dependencies;
    this.attempt = null;
    this.set({ visible: false, phase: 'quoting', target, quote: null, receipt: null });
    const current = (): boolean => this.active && version === this.version && this.context.key === context.key && this.context.enabled && this.context.revision === context.revision;
    try {
      const prepared = await dependencies.prepare(target);
      if (!current()) return;
      if (prepared === null) { this.set({ visible: false, phase: 'closed' }); return; }
      this.set({ visible: true, target: prepared });
      const quote = await dependencies.createQuote(prepared, context.organizationId);
      if (!current()) return;
      if (!dependencies.quoteMatchesTarget(quote, prepared) ||
          quote.billing_scope.organization_id !== context.organizationId || quote.billing_scope.kind !== (context.organizationId === null ? 'personal' : 'organization')) throw new Error('Quote target mismatch');
      this.attempt = { quote, target: prepared, context, requestKey: null, dependencies };
      this.set({ phase: quote.blockers.length > 0 ? 'blocked' : 'review', target: prepared, quote });
    } catch { if (current()) this.set({ phase: 'error', visible: true }); }
  }
  private async acceptReceipt(receipt: GenerationQuoteReceipt, attempt: Attempt<Target, PreparedTarget>): Promise<boolean> {
    if (receipt.quote_id !== attempt.quote.quote_id || receipt.amount_credits !== attempt.quote.amount_credits) throw new Error('Quote receipt mismatch');
    if (receipt.job_id === null || receipt.accepted_at === null) return false;
    if (this.snapshot.phase === 'accepted' && this.snapshot.receipt?.job_id === receipt.job_id && this.snapshot.receipt.quote_id === receipt.quote_id) return true;
    this.set({ phase: 'accepted', visible: false, receipt });
    if (!this.active || !this.context.enabled || this.context.key !== attempt.context.key || this.context.revision !== attempt.context.revision) return true;
    await Promise.resolve(attempt.dependencies.onAccepted(receipt, attempt.target, attempt.context.key)).catch(() => undefined);
    return true;
  }
  public async reconcile(): Promise<void> {
    const attempt = this.attempt;
    if (!this.active || attempt === null || this.busy || this.context.key !== attempt.context.key) return;
    this.busy = true;
    try {
      const receipt = await attempt.dependencies.getReceipt(attempt.quote.quote_id, attempt.context.organizationId);
      if (!(await this.acceptReceipt(receipt, attempt))) this.set({ phase: 'unknown', receipt });
    } catch { this.set({ phase: 'unknown' }); }
    finally { this.busy = false; }
  }
  public async accept(): Promise<void> {
    const attempt = this.attempt;
    if (attempt === null || !this.canAccept()) return;
    const unknown = this.snapshot.phase === 'unknown';
    if (!unknown && Date.parse(attempt.quote.expires_at) <= attempt.dependencies.now()) { this.set({ phase: 'stale' }); return; }
    if (attempt.quote.blockers.length > 0) { this.set({ phase: 'blocked' }); return; }
    this.busy = true;
    this.set({ phase: 'accepting' });
    attempt.requestKey ??= attempt.dependencies.requestKey();
    try {
      if (unknown) {
        const receipt = await attempt.dependencies.getReceipt(attempt.quote.quote_id, attempt.context.organizationId);
        if (await this.acceptReceipt(receipt, attempt)) return;
      }
      if (!this.context.enabled || this.context.key !== attempt.context.key || this.context.revision !== attempt.context.revision) { this.set({ phase: unknown ? 'unknown' : 'review', visible: false }); return; }
      const receipt = await attempt.dependencies.acceptQuote(attempt.quote.quote_id, { quote_token: attempt.quote.quote_token, request_key: attempt.requestKey }, attempt.context.organizationId);
      if (!(await this.acceptReceipt(receipt, attempt))) this.set({ phase: 'unknown', receipt });
    } catch (error) {
      if (!this.active || this.context.key !== attempt.context.key) { this.set({ phase: 'unknown', visible: false }); return; }
      // A rejected response can arrive after admission committed. Check the
      // receipt before allowing a new quote or claiming that no charge occurred.
      try {
        const receipt = await attempt.dependencies.getReceipt(attempt.quote.quote_id, attempt.context.organizationId);
        if (await this.acceptReceipt(receipt, attempt)) return;
        const status = error !== null && typeof error === 'object' && 'status' in error ? error.status : null;
        this.set({ phase: status === 409 || status === 422 ? 'stale' : 'unknown', receipt });
      } catch { this.set({ phase: 'unknown' }); }
    } finally { this.busy = false; }
  }
}
