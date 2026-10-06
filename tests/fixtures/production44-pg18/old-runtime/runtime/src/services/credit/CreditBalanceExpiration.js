export const systemClock = () => new Date();
export function isMonthlyCreditExpired(balance, now) {
    return balance.monthlyExpiresAt !== null && balance.monthlyExpiresAt.getTime() <= now.getTime();
}
export function normalizeExpiredMonthlyCredits(balance, now) {
    if (!isMonthlyCreditExpired(balance, now)) {
        return balance;
    }
    return {
        ...balance,
        monthlyCredits: 0,
        monthlyExpiresAt: null,
    };
}
