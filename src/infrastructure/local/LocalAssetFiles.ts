import path from 'node:path';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { SupportedImageMimeType } from '../aws/S3StoredImageLoader.js';

export interface LocalAssetConfig {
  rootDir: string;
  baseUrl: string;
}

export function resolveLocalAssetConfig(
  storageDir: string | undefined,
  baseUrl: string | undefined,
  port: number,
): LocalAssetConfig | null {
  if (storageDir === undefined || storageDir.trim().length === 0) {
    return null;
  }

  return {
    rootDir: path.resolve(storageDir),
    baseUrl: (baseUrl ?? `http://127.0.0.1:${port}/local-assets`).replace(/\/+$/u, ''),
  };
}

export function buildLocalAssetUrl(config: LocalAssetConfig, assetKey: string): string {
  return new URL(assetKey, `${config.baseUrl}/`).toString();
}

export async function writeLocalAsset(
  rootDir: string,
  assetKey: string,
  contents: Buffer,
): Promise<void> {
  const absolutePath = resolveLocalAssetPath(rootDir, assetKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}

export async function copyLocalAsset(
  rootDir: string,
  sourceKey: string,
  destinationKey: string,
): Promise<void> {
  const sourcePath = resolveLocalAssetPath(rootDir, sourceKey);
  const destinationPath = resolveLocalAssetPath(rootDir, destinationKey);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

export async function readLocalAsset(rootDir: string, assetKey: string): Promise<Buffer> {
  return readFile(resolveLocalAssetPath(rootDir, assetKey));
}

export function resolveLocalAssetPath(rootDir: string, assetKey: string): string {
  if (assetKey.length === 0) {
    throw new ConfigurationError('Local asset key must not be empty');
  }

  const rawKey = assetKey.replace(/^\/+/u, '');
  if (hasUnsafeLocalAssetKeySyntax(rawKey)) {
    throw new ConfigurationError('Local asset key is invalid');
  }

  const normalizedKey = path.posix.normalize(rawKey);
  if (normalizedKey === '..' || normalizedKey.startsWith('../')) {
    throw new ConfigurationError('Local asset key is invalid');
  }

  const absoluteRoot = path.resolve(rootDir);
  const absolutePath = path.resolve(absoluteRoot, ...normalizedKey.split('/'));
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new ConfigurationError('Local asset key is invalid');
  }

  return absolutePath;
}

function hasUnsafeLocalAssetKeySyntax(assetKey: string): boolean {
  if (assetKey.includes('\\') || assetKey.includes('\0')) {
    return true;
  }

  return assetKey.split('/').some((segment) => (
    segment.length === 0 ||
    segment === '.' ||
    segment === '..'
  ));
}

export function inferImageMimeTypeFromKey(assetKey: string): SupportedImageMimeType {
  const extension = inferImageExtensionFromKey(assetKey);
  if (extension === 'jpeg') {
    return 'image/jpeg';
  }

  if (extension === 'webp') {
    return 'image/webp';
  }

  return 'image/png';
}

export function inferImageExtensionFromKey(assetKey: string): 'png' | 'jpeg' | 'webp' {
  if (assetKey.endsWith('.png')) {
    return 'png';
  }

  if (assetKey.endsWith('.jpeg') || assetKey.endsWith('.jpg')) {
    return 'jpeg';
  }

  if (assetKey.endsWith('.webp')) {
    return 'webp';
  }

  throw new ConfigurationError(`Unsupported local image asset extension: ${assetKey}`);
}

