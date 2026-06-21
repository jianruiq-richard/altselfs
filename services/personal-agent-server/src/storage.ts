import type { ServerConfig } from './config.js';
import { FileMemoryReviewQueue, type MemoryReviewJobStore } from './memory-review-queue.js';
import { PostgresMemoryReviewJobStore, PostgresUserProfileStore } from './postgres-stores.js';
import { LocalProfileStore, type UserProfileStore } from './profile-store.js';

export type AgentStores = {
  userProfileStore: UserProfileStore;
  memoryReviewJobStore: MemoryReviewJobStore;
};

export function createStores(config: ServerConfig): AgentStores {
  if (config.storageBackend === 'postgres') {
    return {
      userProfileStore: new PostgresUserProfileStore(config),
      memoryReviewJobStore: new PostgresMemoryReviewJobStore(config),
    };
  }
  return {
    userProfileStore: new LocalProfileStore(config.profileStorePath),
    memoryReviewJobStore: new FileMemoryReviewQueue(config),
  };
}
