import { SIGNUP_BONUS_CREDITS } from '../../domain/constants/credits.js';
import { InsufficientCreditsError } from '../../domain/errors/index.js';
import { isMonthlyCreditExpired, normalizeExpiredMonthlyCredits, systemClock, } from './CreditBalanceExpiration.js';
import { assertPositiveSafeCreditAmount } from './CreditAmountValidation.js';
export class CreditService {
    creditRepository;
    clock;
    constructor(creditRepository, clock = systemClock) {
        this.creditRepository = creditRepository;
        this.clock = clock;
    }
    async getBalance(userId) {
        const balance = await this.creditRepository.getBalance(userId);
        return toSnapshot(this.normalizeBalance(balance ?? emptyBalance(userId)));
    }
    async grantSignupBonus(userId) {
        return this.creditRepository.transaction(async (client) => {
            const currentBalance = this.normalizeBalance((await this.creditRepository.getBalanceForUpdate(userId, client)) ?? emptyBalance(userId));
            if (await this.creditRepository.hasLedgerEntry(userId, 'signup_bonus', client)) {
                return toSnapshot(currentBalance);
            }
            const nextBalance = {
                ...currentBalance,
                purchasedCredits: currentBalance.purchasedCredits + SIGNUP_BONUS_CREDITS,
            };
            const savedBalance = currentBalance.monthlyCredits === 0 &&
                currentBalance.purchasedCredits === 0 &&
                (await this.creditRepository.getBalance(userId, client)) === null
                ? await this.creditRepository.createBalance(nextBalance, client)
                : await this.creditRepository.updateBalance(nextBalance, client);
            await this.creditRepository.insertLedger({
                userId,
                type: 'signup_bonus',
                amount: SIGNUP_BONUS_CREDITS,
                monthlyDelta: 0,
                purchasedDelta: SIGNUP_BONUS_CREDITS,
                monthlyAfter: savedBalance.monthlyCredits,
                purchasedAfter: savedBalance.purchasedCredits,
                description: 'Initial free plan signup bonus',
            }, client);
            return toSnapshot(savedBalance);
        });
    }
    async consumeCredits(params) {
        assertPositiveSafeCreditAmount(params.cost, 'Credit cost');
        return this.creditRepository.transaction(async (client) => {
            const currentBalance = this.normalizeBalance((await this.creditRepository.getBalanceForUpdate(params.userId, client)) ?? emptyBalance(params.userId));
            const totalCredits = currentBalance.monthlyCredits + currentBalance.purchasedCredits;
            if (totalCredits < params.cost) {
                throw new InsufficientCreditsError();
            }
            const monthlyDeduct = Math.min(currentBalance.monthlyCredits, params.cost);
            const purchasedDeduct = params.cost - monthlyDeduct;
            const nextBalance = {
                ...currentBalance,
                monthlyCredits: currentBalance.monthlyCredits - monthlyDeduct,
                purchasedCredits: currentBalance.purchasedCredits - purchasedDeduct,
            };
            const savedBalance = currentBalance.monthlyCredits === 0 &&
                currentBalance.purchasedCredits === 0 &&
                (await this.creditRepository.getBalance(params.userId, client)) === null
                ? await this.creditRepository.createBalance(nextBalance, client)
                : await this.creditRepository.updateBalance(nextBalance, client);
            await this.creditRepository.insertLedger({
                userId: params.userId,
                type: 'consume',
                amount: -params.cost,
                monthlyDelta: monthlyDeduct === 0 ? 0 : -monthlyDeduct,
                purchasedDelta: purchasedDeduct === 0 ? 0 : -purchasedDeduct,
                monthlyAfter: savedBalance.monthlyCredits,
                purchasedAfter: savedBalance.purchasedCredits,
                description: params.description,
                jobId: params.jobId,
            }, client);
            return toSnapshot(savedBalance);
        });
    }
    async refundCredits(params) {
        assertPositiveSafeCreditAmount(params.amount, 'Credit refund amount');
        return this.creditRepository.transaction(async (client) => {
            const lockedBalance = (await this.creditRepository.getBalanceForUpdate(params.userId, client)) ?? emptyBalance(params.userId);
            const now = this.clock();
            const monthlyExpired = isMonthlyCreditExpired(lockedBalance, now);
            const currentBalance = normalizeExpiredMonthlyCredits(lockedBalance, now);
            let refundAmount = params.amount;
            let refundMonthlyDelta = 0;
            let refundPurchasedDelta = params.amount;
            if (params.jobId !== undefined) {
                const refundDeltas = await this.calculateJobScopedRefundDeltas(params.userId, params.jobId, params.amount, client);
                if (refundDeltas === null) {
                    return toSnapshot(currentBalance);
                }
                refundAmount = refundDeltas.amount;
                refundMonthlyDelta = refundDeltas.monthlyDelta;
                refundPurchasedDelta = refundDeltas.purchasedDelta;
                if (monthlyExpired && refundMonthlyDelta > 0) {
                    refundPurchasedDelta += refundMonthlyDelta;
                    refundMonthlyDelta = 0;
                }
            }
            const nextBalance = {
                ...currentBalance,
                monthlyCredits: currentBalance.monthlyCredits + refundMonthlyDelta,
                purchasedCredits: currentBalance.purchasedCredits + refundPurchasedDelta,
            };
            const savedBalance = currentBalance.monthlyCredits === 0 &&
                currentBalance.purchasedCredits === 0 &&
                (await this.creditRepository.getBalance(params.userId, client)) === null
                ? await this.creditRepository.createBalance(nextBalance, client)
                : await this.creditRepository.updateBalance(nextBalance, client);
            await this.creditRepository.insertLedger({
                userId: params.userId,
                type: 'refund',
                amount: refundAmount,
                monthlyDelta: refundMonthlyDelta,
                purchasedDelta: refundPurchasedDelta,
                monthlyAfter: savedBalance.monthlyCredits,
                purchasedAfter: savedBalance.purchasedCredits,
                description: params.description,
                jobId: params.jobId,
            }, client);
            return toSnapshot(savedBalance);
        });
    }
    async calculateJobScopedRefundDeltas(userId, jobId, requestedAmount, client) {
        const consumedDeltas = await this.creditRepository.sumJobLedgerBucketDeltas(userId, 'consume', jobId, client);
        const refundedDeltas = await this.creditRepository.sumJobLedgerBucketDeltas(userId, 'refund', jobId, client);
        if (consumedDeltas.entryCount > 0 &&
            hasCompleteBucketDeltas(consumedDeltas) &&
            hasCompleteBucketDeltas(refundedDeltas)) {
            const remainingMonthly = Math.max(0, -consumedDeltas.monthlyDelta - refundedDeltas.monthlyDelta);
            const remainingPurchased = Math.max(0, -consumedDeltas.purchasedDelta - refundedDeltas.purchasedDelta);
            const refundableAmount = remainingMonthly + remainingPurchased;
            if (refundableAmount <= 0) {
                return null;
            }
            const amount = Math.min(requestedAmount, refundableAmount);
            const monthlyDelta = Math.min(remainingMonthly, amount);
            return {
                amount,
                monthlyDelta,
                purchasedDelta: amount - monthlyDelta,
            };
        }
        // Older ledger rows do not have bucket deltas. Keep the historical behavior
        // but still cap by total consumed amount to avoid over-crediting.
        const consumedAmount = Math.abs(await this.creditRepository.sumJobLedgerAmount(userId, 'consume', jobId, client));
        const refundedAmount = await this.creditRepository.sumJobLedgerAmount(userId, 'refund', jobId, client);
        const refundableAmount = consumedAmount - refundedAmount;
        if (refundableAmount <= 0) {
            return null;
        }
        const amount = Math.min(requestedAmount, refundableAmount);
        return {
            amount,
            monthlyDelta: 0,
            purchasedDelta: amount,
        };
    }
    normalizeBalance(balance) {
        return normalizeExpiredMonthlyCredits(balance, this.clock());
    }
}
function hasCompleteBucketDeltas(summary) {
    return summary.entryCount === summary.completeEntryCount;
}
function emptyBalance(userId) {
    return {
        userId,
        monthlyCredits: 0,
        purchasedCredits: 0,
        monthlyExpiresAt: null,
    };
}
function toSnapshot(balance) {
    return {
        monthlyCredits: balance.monthlyCredits,
        purchasedCredits: balance.purchasedCredits,
        totalCredits: balance.monthlyCredits + balance.purchasedCredits,
        monthlyExpiresAt: balance.monthlyExpiresAt,
    };
}
