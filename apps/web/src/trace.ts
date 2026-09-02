import type { IntegrationAttempt } from './types';

/**
 * A transport observation can share an attempt number with the request that
 * produced it (for example, COMMITTED + RESPONSE_LOST are both attempt 1).
 * Count logical attempts, not rows in the evidence ledger.
 */
export function countLogicalAttempts(
  attempts: IntegrationAttempt[],
  selected: Pick<IntegrationAttempt, 'operationKey' | 'correlationId'>,
): number {
  return new Set(
    attempts
      .filter((attempt) =>
        attempt.operationKey === selected.operationKey
        && attempt.correlationId === selected.correlationId)
      .map((attempt) => attempt.attempt),
  ).size;
}
