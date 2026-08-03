import type { ServerConfig } from '../config.js';
import {
  CodexOpenAiAuthHealthError,
  ensureCodexOpenAiAuthHealthy,
  shouldCheckCodexOpenAiAuth,
} from './openai-auth-health.js';

export class CodexOpenAiAuthHealthMonitor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(private readonly config: ServerConfig) {}

  start() {
    const selection = {
      model: this.config.codexModel,
      provider: this.config.codexModelProvider,
    };
    if (!shouldCheckCodexOpenAiAuth(this.config, selection)) return;

    const intervalMs = Math.max(60_000, this.config.codexOpenAiAuthHealthCheckIntervalMs);
    void this.check('startup', true);
    this.timer = setInterval(() => {
      void this.check('interval', false);
    }, intervalMs);
    const maybeTimer = this.timer as { unref?: () => void };
    maybeTimer.unref?.();
    console.log(`[codex-openai-auth-health] monitor started intervalMs=${intervalMs}`);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async check(reason: string, force: boolean) {
    if (this.running) return;
    this.running = true;
    try {
      const result = await ensureCodexOpenAiAuthHealthy(this.config, {
        model: this.config.codexModel,
        provider: this.config.codexModelProvider,
      }, { reason, force });
      console.log(
        `[codex-openai-auth-health] ${result.status} category=${result.category} durationMs=${result.durationMs ?? 0}`
      );
    } catch (error) {
      if (error instanceof CodexOpenAiAuthHealthError) {
        console.warn(
          `[codex-openai-auth-health] unhealthy category=${error.result.category} message=${error.message}`
        );
        return;
      }
      console.warn(`[codex-openai-auth-health] check failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
