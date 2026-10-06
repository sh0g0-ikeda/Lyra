export const MAX_GENERATION_JOB_CREDIT_SETTLEMENT_CREDITS = 2_147_483_647;
export function createGenerationJobCreditSettlement(status, chargedCredits, refundedCredits) {
    const charged = toBoundedCreditAmount(chargedCredits);
    const refunded = Math.min(charged, toBoundedCreditAmount(refundedCredits));
    const netCredits = charged - refunded;
    if (charged === 0) {
        return { chargedCredits: 0, refundedCredits: 0, netCredits: 0, status: 'not_charged' };
    }
    if (netCredits === 0) {
        return { chargedCredits: charged, refundedCredits: refunded, netCredits, status: 'refunded' };
    }
    if (refunded > 0) {
        return { chargedCredits: charged, refundedCredits: refunded, netCredits, status: 'partially_refunded' };
    }
    if (status === 'failed' || status === 'cancelled') {
        return { chargedCredits: charged, refundedCredits: 0, netCredits, status: 'refund_pending' };
    }
    return { chargedCredits: charged, refundedCredits: 0, netCredits, status: 'charged' };
}
function toBoundedCreditAmount(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.min(MAX_GENERATION_JOB_CREDIT_SETTLEMENT_CREDITS, Math.floor(value));
}
