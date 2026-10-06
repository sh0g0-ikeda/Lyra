import { assessDatabaseDrainProof } from './stage-lifecycle-guard-core.mjs';

const FUNCTION_PREFIX='arn:aws:lambda:ap-northeast-1:452284481392:function:lyra-staging-20261003-database-drain-proof:';
const MAX_PAYLOAD_BYTES=2048;
const INVOKE_TIMEOUT_MS=15000;
const CANONICAL_UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
function validTime(value) { return typeof value==='string' && CANONICAL_UTC.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString()===value; }
function record(value) { return typeof value==='object' && value!==null && !Array.isArray(value); }
function fail() { throw Error('DATABASE_DRAIN_INVOKE_FAILED'); }

// The guard can invoke only the deployed immutable count-only executor version.
// There are no caller-controlled SQL, database, credentials or time arguments.
export function createStageDatabaseDrainInvokePort({functionArn,lambda,invokeCommand}) {
  if(typeof functionArn!=='string'||!functionArn.startsWith(FUNCTION_PREFIX)) fail();
  const version=functionArn.slice(FUNCTION_PREFIX.length);
  if(!/^[1-9][0-9]{0,8}$/u.test(version)||typeof lambda?.send!=='function'||typeof invokeCommand!=='function') fail();
  return { async collect({nowUtc,safePointAtUtc,proofSchemaVersion=1}) {
    try {
      if(!validTime(nowUtc)||!validTime(safePointAtUtc)||Date.parse(safePointAtUtc)>Date.parse(nowUtc)||![1,2].includes(proofSchemaVersion)) fail();
      const response=await lambda.send(invokeCommand({FunctionName:functionArn,InvocationType:'RequestResponse',Payload:new TextEncoder().encode(proofSchemaVersion===1?'{}':JSON.stringify({schemaVersion:2}))}),{abortSignal:AbortSignal.timeout(INVOKE_TIMEOUT_MS)});
      if(response?.StatusCode!==200||response.ExecutedVersion!==version||response.FunctionError) fail();
      if(!(response.Payload instanceof Uint8Array)||response.Payload.byteLength===0||response.Payload.byteLength>MAX_PAYLOAD_BYTES) fail();
      const output=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.Payload));
      if(!record(output)||Object.keys(output).sort().join(',')!=='ok,proof'||output.ok!==true) fail();
      const assessment=assessDatabaseDrainProof({proof:output.proof,nowEpoch:Date.parse(nowUtc),notBefore:safePointAtUtc,expectedObservedAt:null,requireFresh:true,expectedSchemaVersion:proofSchemaVersion});
      if(!assessment.ready&&assessment.reason!=='nonzero') fail();
      return output.proof;
    } catch { fail(); }
  }};
}
