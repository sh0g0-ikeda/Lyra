import type { OperationalMetric } from '@/lib/observabilityPolicy';

interface OperationalEventSinks {
  exception: (error: unknown) => void;
  metric: (metric: OperationalMetric) => void;
}

let activeSinks: OperationalEventSinks | null = null;

export const setOperationalEventSinks = (
  sinks: OperationalEventSinks | null
): void => {
  activeSinks = sinks;
};

export const recordOperationalMetric = (metric: OperationalMetric): void => {
  activeSinks?.metric(metric);
};

export const captureHandledException = (error: unknown): void => {
  activeSinks?.exception(error);
};
