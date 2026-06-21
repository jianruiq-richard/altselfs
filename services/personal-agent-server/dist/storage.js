import { FileMemoryReviewQueue } from './memory-review-queue.js';
import { PostgresMemoryReviewJobStore, PostgresUserProfileStore } from './postgres-stores.js';
import { LocalProfileStore } from './profile-store.js';
export function createStores(config) {
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
