import { existsSync } from 'node:fs';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigurationError } from '../../domain/errors/index.js';

export interface WorkerProcessLauncher {
  launch(jobId: string): void;
}

type SpawnLike = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface DetachedWorkerProcessLauncherOptions {
  projectRoot?: string;
  nodeExecutable?: string;
  spawnFn?: SpawnLike;
}

/**
 * Launches a dedicated tsx worker process for a generation job so local
 * background work survives API process restarts.
 */
export class DetachedWorkerProcessLauncher implements WorkerProcessLauncher {
  private readonly projectRoot: string;
  private readonly nodeExecutable: string;
  private readonly spawnFn: SpawnLike;

  public constructor(
    private readonly scriptRelativePath: string,
    options: DetachedWorkerProcessLauncherOptions = {},
  ) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.nodeExecutable = options.nodeExecutable ?? process.execPath;
    this.spawnFn = options.spawnFn ?? spawn;
  }

  public launch(jobId: string): void {
    const preflightPath = path.join(this.projectRoot, 'node_modules', 'tsx', 'dist', 'preflight.cjs');
    const loaderPath = path.join(this.projectRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
    const scriptPath = path.join(
      this.projectRoot,
      ...this.scriptRelativePath.split(/[\\/]+/u),
    );

    assertFileExists(preflightPath, 'TSX preflight module');
    assertFileExists(loaderPath, 'TSX loader module');
    assertFileExists(scriptPath, 'Worker script');

    const child = this.spawnFn(
      this.nodeExecutable,
      ['--require', preflightPath, '--import', pathToFileURL(loaderPath).href, scriptPath, jobId],
      {
        cwd: this.projectRoot,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    child.unref();
  }
}

function assertFileExists(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new ConfigurationError(`${label} is not available at ${filePath}`);
  }
}
