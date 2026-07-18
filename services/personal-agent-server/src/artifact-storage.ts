import crypto from 'node:crypto';
import path from 'node:path';
import type { ServerConfig } from './config.js';
import { sanitizePathSegment } from './sandbox-runtime.js';

export type DirectUploadFileInput = {
  artifactId: string;
  userId: string;
  investorId: string;
  threadId: string;
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

export type DirectUploadPolicy = {
  artifactId: string;
  objectKey: string;
  expiresAt: string;
  upload: {
    method: 'POST';
    url: string;
    fields: Record<string, string>;
  };
};

export function isArtifactObjectStorageConfigured(config: ServerConfig) {
  if (!config.artifactObjectStorageEnabled) return false;
  const credentials = getObjectStorageCredentials(config);
  return Boolean(config.artifactObjectStorageBucket && config.artifactObjectStorageEndpoint && credentials.accessKeyId && credentials.accessKeySecret);
}

export function requireArtifactObjectStorage(config: ServerConfig) {
  const credentials = getObjectStorageCredentials(config);
  if (!config.artifactObjectStorageEnabled) {
    throw new Error('Artifact object storage is disabled. Set ARTIFACT_OBJECT_STORAGE_ENABLED=true.');
  }
  if (!config.artifactObjectStorageBucket.trim()) {
    throw new Error('ARTIFACT_OBJECT_STORAGE_BUCKET is required when artifact object storage is enabled.');
  }
  if (!config.artifactObjectStorageEndpoint.trim()) {
    throw new Error('ARTIFACT_OBJECT_STORAGE_ENDPOINT is required when artifact object storage is enabled.');
  }
  if (!credentials.accessKeyId || !credentials.accessKeySecret) {
    throw new Error(`${config.artifactObjectStorageAccessKeyIdEnv} and ${config.artifactObjectStorageAccessKeySecretEnv} are required for artifact object storage.`);
  }
  return credentials;
}

export function createDirectUploadPolicy(config: ServerConfig, input: DirectUploadFileInput): DirectUploadPolicy {
  const credentials = requireArtifactObjectStorage(config);
  const objectKey = buildUploadedObjectKey(input);
  const expiresAt = new Date(Date.now() + Math.max(60, config.artifactObjectStorageUploadTtlSeconds) * 1000).toISOString();
  const maxBytes = Math.max(1, config.artifactObjectStorageUploadMaxBytes);
  const policy = {
    expiration: expiresAt,
    conditions: [
      ['eq', '$key', objectKey],
      ['content-length-range', 1, maxBytes],
      ['eq', '$success_action_status', '200'],
    ],
  };
  const encodedPolicy = Buffer.from(JSON.stringify(policy), 'utf8').toString('base64');
  const signature = signHmacSha1Base64(credentials.accessKeySecret, encodedPolicy);
  return {
    artifactId: input.artifactId,
    objectKey,
    expiresAt,
    upload: {
      method: 'POST',
      url: objectStorageBucketUrl(config, { internal: false }),
      fields: {
        key: objectKey,
        policy: encodedPolicy,
        OSSAccessKeyId: credentials.accessKeyId,
        Signature: signature,
        success_action_status: '200',
      },
    },
  };
}

export function createSignedObjectUrl(
  config: ServerConfig,
  input: { objectKey: string; method?: 'GET' | 'HEAD'; expiresInSeconds?: number }
) {
  const credentials = requireArtifactObjectStorage(config);
  const method = input.method || 'GET';
  const expires = Math.floor(Date.now() / 1000) + Math.max(60, input.expiresInSeconds || config.artifactObjectStorageDownloadTtlSeconds);
  const canonicalResource = `/${config.artifactObjectStorageBucket}/${input.objectKey}`;
  const stringToSign = `${method}\n\n\n${expires}\n${canonicalResource}`;
  const signature = signHmacSha1Base64(credentials.accessKeySecret, stringToSign);
  const query = new URLSearchParams({
    OSSAccessKeyId: credentials.accessKeyId,
    Expires: String(expires),
    Signature: signature,
  });
  return `${objectStorageBucketUrl(config, { internal: false })}${encodeObjectKeyPath(input.objectKey)}?${query.toString()}`;
}

export async function downloadObjectToBuffer(config: ServerConfig, objectKey: string) {
  const response = await fetch(createSignedObjectUrlForEndpoint(config, {
    objectKey,
    method: 'GET',
    internal: true,
  }), {
    method: 'GET',
  });
  if (!response.ok) {
    throw new Error(`OSS object download failed with HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function uploadBufferToObject(
  config: ServerConfig,
  input: { objectKey: string; bytes: Buffer; mimeType?: string | null }
) {
  const credentials = requireArtifactObjectStorage(config);
  const date = new Date().toUTCString();
  const mimeType = input.mimeType || 'application/octet-stream';
  const canonicalResource = `/${config.artifactObjectStorageBucket}/${input.objectKey}`;
  const stringToSign = `PUT\n\n${mimeType}\n${date}\n${canonicalResource}`;
  const signature = signHmacSha1Base64(credentials.accessKeySecret, stringToSign);
  const response = await fetch(`${objectStorageBucketUrl(config, { internal: true })}${encodeObjectKeyPath(input.objectKey)}`, {
    method: 'PUT',
    headers: {
      Authorization: `OSS ${credentials.accessKeyId}:${signature}`,
      Date: date,
      'Content-Type': mimeType,
      'Content-Length': String(input.bytes.length),
    },
    body: input.bytes,
  });
  if (!response.ok) {
    throw new Error(`OSS object upload failed with HTTP ${response.status}`);
  }
}

export function buildGeneratedObjectKey(input: {
  userId: string;
  threadId: string;
  runId: string;
  relativePath: string;
}) {
  const userSegment = sanitizePathSegment(input.userId || 'unknown-user');
  const threadSegment = sanitizePathSegment(input.threadId || 'default');
  const runSegment = sanitizePathSegment(input.runId || 'run');
  const safeRelativePath = input.relativePath
    .split(/[\\/]+/)
    .map((segment) => sanitizePathSegment(segment || 'file'))
    .join('/');
  return `users/${userSegment}/threads/${threadSegment}/generated/${runSegment}/${safeRelativePath}`;
}

function buildUploadedObjectKey(input: DirectUploadFileInput) {
  const userSegment = sanitizePathSegment(input.userId || input.investorId || 'unknown-user');
  const threadSegment = sanitizePathSegment(input.threadId || 'default');
  const artifactSegment = sanitizePathSegment(input.artifactId);
  const name = sanitizeObjectName(input.name || 'attachment');
  return `users/${userSegment}/threads/${threadSegment}/uploads/${artifactSegment}/${name}`;
}

function createSignedObjectUrlForEndpoint(
  config: ServerConfig,
  input: { objectKey: string; method: 'GET' | 'HEAD'; internal: boolean }
) {
  const credentials = requireArtifactObjectStorage(config);
  const expires = Math.floor(Date.now() / 1000) + Math.max(60, config.artifactObjectStorageDownloadTtlSeconds);
  const canonicalResource = `/${config.artifactObjectStorageBucket}/${input.objectKey}`;
  const stringToSign = `${input.method}\n\n\n${expires}\n${canonicalResource}`;
  const signature = signHmacSha1Base64(credentials.accessKeySecret, stringToSign);
  const query = new URLSearchParams({
    OSSAccessKeyId: credentials.accessKeyId,
    Expires: String(expires),
    Signature: signature,
  });
  return `${objectStorageBucketUrl(config, { internal: input.internal })}${encodeObjectKeyPath(input.objectKey)}?${query.toString()}`;
}

function objectStorageBucketUrl(config: ServerConfig, options: { internal: boolean }) {
  const rawEndpoint = options.internal && config.artifactObjectStorageInternalEndpoint
    ? config.artifactObjectStorageInternalEndpoint
    : config.artifactObjectStorageEndpoint;
  const endpoint = rawEndpoint.trim().replace(/\/$/, '').replace(/^https?:\/\//, '');
  return `https://${config.artifactObjectStorageBucket}.${endpoint}/`;
}

function getObjectStorageCredentials(config: ServerConfig) {
  return {
    accessKeyId: process.env[config.artifactObjectStorageAccessKeyIdEnv]?.trim() || '',
    accessKeySecret: process.env[config.artifactObjectStorageAccessKeySecretEnv]?.trim() || '',
  };
}

function signHmacSha1Base64(secret: string, value: string) {
  return crypto.createHmac('sha1', secret).update(value, 'utf8').digest('base64');
}

function sanitizeObjectName(name: string) {
  const normalized = path.basename(name)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return normalized || 'attachment';
}

function encodeObjectKeyPath(objectKey: string) {
  return objectKey.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}
