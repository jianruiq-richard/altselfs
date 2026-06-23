import type { ServerConfig } from './config.js';
import { FileMemoryReviewQueue, type MemoryReviewJobStore } from './memory-review-queue.js';
import { PostgresMemoryReviewJobStore, PostgresUserProfileStore } from './postgres-stores.js';
import { LocalProfileStore, type UserProfileStore } from './profile-store.js';
import {
  NoopRuntimeStateStore,
  PostgresRuntimeStateStore,
  type RuntimeStateStore,
} from './runtime-state-store.js';

export type AgentStores = {
  userProfileStore: UserProfileStore;
  memoryReviewJobStore: MemoryReviewJobStore;
  runtimeStateStore: RuntimeStateStore;
};

export function createStores(config: ServerConfig): AgentStores {
  if (config.storageBackend === 'postgres') {
    return {
      userProfileStore: new PostgresUserProfileStore(config),
      memoryReviewJobStore: new PostgresMemoryReviewJobStore(config),
      runtimeStateStore: config.runtimeStateSyncEnabled
        ? new PostgresRuntimeStateStore(config)
        : new NoopRuntimeStateStore(),
    };
  }
  return {
    userProfileStore: new LocalProfileStore(config.profileStorePath),
    memoryReviewJobStore: new FileMemoryReviewQueue(config),
    runtimeStateStore: new NoopRuntimeStateStore(),
  };
}
