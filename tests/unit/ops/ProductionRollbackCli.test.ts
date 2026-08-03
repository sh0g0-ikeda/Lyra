import { describe, expect, it } from 'vitest';
import { parseProductionRollbackCliArgs } from '../../../src/ops/ProductionRollbackCli.js';

describe('ProductionRollbackCli', () => {
  it('引数がない場合にdry-runと環境変数のprofileを使う', () => {
    expect(parseProductionRollbackCliArgs([], { AWS_PROFILE: 'lyra-operator' })).toEqual({
      apply: false,
      profile: 'lyra-operator',
      confirmation: undefined,
      awsCliPath: undefined,
    });
  });

  it('applyと確認文字列とprofileを読み取る', () => {
    expect(
      parseProductionRollbackCliArgs(
        [
          '--apply',
          '--confirm',
          '20260714T1500JST',
          '--profile',
          'lyra-admin-temp',
          '--aws-cli',
          'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe',
        ],
        {},
      ),
    ).toEqual({
      apply: true,
      profile: 'lyra-admin-temp',
      confirmation: '20260714T1500JST',
      awsCliPath: 'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe',
    });
  });

  it('profileが指定されていない場合に拒否する', () => {
    expect(() => parseProductionRollbackCliArgs([], {})).toThrow(
      'AWS profile is required',
    );
  });

  it('未知の引数または値のない引数を拒否する', () => {
    expect(() => parseProductionRollbackCliArgs(['--unknown'], { AWS_PROFILE: 'operator' })).toThrow(
      'Unknown rollback option: --unknown',
    );
    expect(() => parseProductionRollbackCliArgs(['--profile'], {})).toThrow(
      '--profile requires a value',
    );
  });
});
