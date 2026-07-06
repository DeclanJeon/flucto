type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private stateValue: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureAt = 0;
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;

  constructor(failureThreshold = 5, recoveryTimeoutMs = 60_000) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
  }

  get state(): CircuitState {
    if (this.stateValue === 'open' && Date.now() - this.lastFailureAt >= this.recoveryTimeoutMs) {
      return 'half-open';
    }
    return this.stateValue;
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.stateValue = 'closed';
  }

  recordFailure(): void {
    this.failureCount += 1;
    this.lastFailureAt = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.stateValue = 'open';
    }
  }

  reset(): void {
    this.failureCount = 0;
    this.lastFailureAt = 0;
    this.stateValue = 'closed';
  }
}
