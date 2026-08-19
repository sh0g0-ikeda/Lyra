import { execFile } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import {
  assertAccountDeletionWorkerArtifact,
  readImageConfigPlatform,
  selectLinuxArm64ManifestDigest,
} from '../src/infrastructure/account/AccountDeletionWorkerArtifactPreflight.js';

const ACCEPTED_MANIFEST_MEDIA_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
];
const MAX_UNCOMPRESSED_LAYER_BYTES = 512 * 1024 * 1024;

async function main(): Promise<void> {
  const repositoryName = requireEnvironment('ACCOUNT_DELETION_ECR_REPOSITORY');
  const imageDigest = requireEnvironment('ACCOUNT_DELETION_IMAGE_DIGEST');
  const sourceRevision = requireEnvironment('ACCOUNT_DELETION_IMAGE_SOURCE_REVISION');

  const describedDigest = await runAws([
    'ecr',
    'describe-images',
    '--repository-name', repositoryName,
    '--image-ids', `imageDigest=${imageDigest}`,
    '--query', 'imageDetails[0].imageDigest',
    '--output', 'text',
  ]);
  if (describedDigest.trim() !== imageDigest) {
    throw new Error('Artifact digest is unavailable');
  }

  const lifecyclePolicy = await runAws([
    'ecr',
    'get-lifecycle-policy',
    '--repository-name', repositoryName,
    '--query', 'lifecyclePolicyText',
    '--output', 'text',
  ]);
  const manifest = await getImageManifest(repositoryName, imageDigest);
  const arm64Manifest = hasManifestList(manifest)
    ? await getImageManifest(repositoryName, selectLinuxArm64ManifestDigest(manifest))
    : manifest;
  const configDigest = readConfigDigest(arm64Manifest);
  const imageConfig = readImageConfigPlatform(
    await getLayerJson(repositoryName, configDigest),
  );
  if (imageConfig.sourceRevision !== sourceRevision) {
    throw new Error('Artifact source revision is not verified');
  }

  const filesystemPaths = await getFilesystemPaths(repositoryName, arm64Manifest);
  assertAccountDeletionWorkerArtifact({
    repositoryName,
    imageDigest,
    sourceRevision,
    architecture: imageConfig.architecture,
    os: imageConfig.os,
    filesystemPaths,
    lifecyclePolicy,
  });
}

async function getImageManifest(
  repositoryName: string,
  imageDigest: string,
): Promise<Record<string, unknown>> {
  const output = await runAws([
    'ecr',
    'batch-get-image',
    '--repository-name', repositoryName,
    '--image-ids', `imageDigest=${imageDigest}`,
    '--accepted-media-types', ...ACCEPTED_MANIFEST_MEDIA_TYPES,
    '--output', 'json',
  ]);
  const response = parseJson(output);
  if (!isRecord(response) || !Array.isArray(response.images)) {
    throw new Error('Artifact manifest is unavailable');
  }
  const image = response.images[0];
  if (!isRecord(image) || typeof image.imageManifest !== 'string') {
    throw new Error('Artifact manifest is invalid');
  }
  const manifest = parseJson(image.imageManifest);
  if (!isRecord(manifest)) {
    throw new Error('Artifact manifest is invalid');
  }
  return manifest;
}

function hasManifestList(manifest: Record<string, unknown>): boolean {
  return Array.isArray(manifest.manifests);
}

function readConfigDigest(manifest: Record<string, unknown>): string {
  if (!isRecord(manifest.config) || typeof manifest.config.digest !== 'string') {
    throw new Error('Artifact config digest is invalid');
  }
  return manifest.config.digest;
}

async function getFilesystemPaths(
  repositoryName: string,
  manifest: Record<string, unknown>,
): Promise<Set<string>> {
  if (!Array.isArray(manifest.layers)) {
    throw new Error('Artifact layers are invalid');
  }
  const paths = new Set<string>();
  for (const layer of manifest.layers) {
    if (!isRecord(layer) || typeof layer.digest !== 'string') {
      throw new Error('Artifact layer is invalid');
    }
    applyLayerPaths(paths, await getLayerBytes(repositoryName, layer.digest));
  }
  return paths;
}

async function getLayerJson(
  repositoryName: string,
  layerDigest: string,
): Promise<unknown> {
  return parseJson(new TextDecoder().decode(
    await getLayerBytes(repositoryName, layerDigest),
  ));
}

async function getLayerBytes(
  repositoryName: string,
  layerDigest: string,
): Promise<Uint8Array> {
  const downloadUrl = await runAws([
    'ecr',
    'get-download-url-for-layer',
    '--repository-name', repositoryName,
    '--layer-digest', layerDigest,
    '--query', 'downloadUrl',
    '--output', 'text',
  ]);
  const response = await fetch(downloadUrl.trim());
  if (!response.ok) {
    throw new Error('Artifact layer is unavailable');
  }
  return new Uint8Array(await response.arrayBuffer());
}

function applyLayerPaths(paths: Set<string>, layer: Uint8Array): void {
  const archive = isGzip(layer)
    ? gunzipSync(layer, { maxOutputLength: MAX_UNCOMPRESSED_LAYER_BYTES })
    : layer;
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      return;
    }
    const size = readTarSize(header);
    const path = readTarPath(header);
    const type = String.fromCharCode(header[156] ?? 0);
    applyTarPath(paths, path, type);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (offset !== archive.length) {
    throw new Error('Artifact layer archive is invalid');
  }
}

function isGzip(value: Uint8Array): boolean {
  return value[0] === 0x1f && value[1] === 0x8b;
}

function readTarSize(header: Uint8Array): number {
  const value = readTarString(header.subarray(124, 136)).trim();
  const size = value.length === 0 ? 0 : Number.parseInt(value, 8);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('Artifact layer archive is invalid');
  }
  return size;
}

function readTarPath(header: Uint8Array): string {
  const prefix = readTarString(header.subarray(345, 500));
  const name = readTarString(header.subarray(0, 100));
  const raw = prefix.length === 0 ? name : `${prefix}/${name}`;
  const normalized = raw.replace(/^\.?\/?/u, '').replace(/\\/gu, '/');
  if (normalized.length === 0 || normalized.includes('../')) {
    throw new Error('Artifact layer path is invalid');
  }
  return normalized;
}

function readTarString(value: Uint8Array): string {
  const terminator = value.indexOf(0);
  return new TextDecoder().decode(value.subarray(0, terminator < 0 ? value.length : terminator));
}

function applyTarPath(paths: Set<string>, path: string, type: string): void {
  const separator = path.lastIndexOf('/');
  const parent = separator < 0 ? '' : path.slice(0, separator);
  const filename = separator < 0 ? path : path.slice(separator + 1);
  if (filename === '.wh..wh..opq') {
    for (const candidate of paths) {
      if (candidate.startsWith(parent.length === 0 ? '' : `${parent}/`)) {
        paths.delete(candidate);
      }
    }
    return;
  }
  if (filename.startsWith('.wh.')) {
    paths.delete(parent.length === 0 ? filename.slice(4) : `${parent}/${filename.slice(4)}`);
    return;
  }
  if (type === '\0' || type === '0') {
    paths.add(path);
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error('Artifact preflight configuration is incomplete');
  }
  return value;
}

function runAws(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('aws', args, { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        reject(new Error('Artifact registry query failed'));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Artifact registry response is invalid');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

void main().then(
  () => {
    console.info('Account-deletion worker artifact preflight passed');
  },
  () => {
    console.error('Account-deletion worker artifact preflight failed');
    process.exitCode = 1;
  },
);
