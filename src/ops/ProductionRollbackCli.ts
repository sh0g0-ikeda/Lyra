import { RollbackSafetyError } from './ProductionRollback.js';

export interface ProductionRollbackCliOptions {
  apply: boolean;
  profile: string;
  confirmation: string | undefined;
  awsCliPath: string | undefined;
}

export function parseProductionRollbackCliArgs(
  args: string[],
  environment: Readonly<Record<string, string | undefined>>,
): ProductionRollbackCliOptions {
  let apply = false;
  let profile = environment.AWS_PROFILE;
  let confirmation: string | undefined;
  let awsCliPath = environment.AWS_CLI_PATH;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--profile') {
      profile = readOptionValue(args, index, '--profile');
      index += 1;
      continue;
    }
    if (argument === '--confirm') {
      confirmation = readOptionValue(args, index, '--confirm');
      index += 1;
      continue;
    }
    if (argument === '--aws-cli') {
      awsCliPath = readOptionValue(args, index, '--aws-cli');
      index += 1;
      continue;
    }

    throw new RollbackSafetyError(`Unknown rollback option: ${argument ?? '(empty)'}`);
  }

  if (profile === undefined || profile.trim() === '') {
    throw new RollbackSafetyError(
      'AWS profile is required. Use --profile or set AWS_PROFILE.',
    );
  }

  return {
    apply,
    profile,
    confirmation,
    awsCliPath,
  };
}

function readOptionValue(args: string[], index: number, optionName: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--') || value.trim() === '') {
    throw new RollbackSafetyError(`${optionName} requires a value`);
  }
  return value;
}
