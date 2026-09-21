import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';

register();
const { run: runSource } = await import('../src/run.ts');
const { configureDeepseekApiKey, createZCodeApp, mapSessionEvent, startProcessProviderRegistryRuntime } = await import('@zcode/bootstrap');

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const entry = join(root, 'apps/zcode-cli/packages/cli/dist/zcode.cjs');
const builtin = join(root, 'config/provider/zcode-builtin.json');

function readBody(req) { return new Promise((resolve, reject) => { let s=''; req.setEncoding('utf8'); req.on('data', c => s += c); req.on('end',()=>resolve(s)); req.on('error',reject); }); }
async function serverFixture(targetPath) {
  const requests=[];
  const server=createServer(async (req,res)=> {
    const body=await readBody(req); requests.push({method:req.method,url:req.url,headers:req.headers,body:JSON.parse(body)});
    const call=requests.length;
    const id=`fixture-${call}`; const created=Math.floor(Date.now()/1000);
    const chunks = call === 1
      ? [
          {id,object:'chat.completion.chunk',created,model:'fixture-model',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_read_1',type:'function',function:{name:'Read',arguments:JSON.stringify({file_path:targetPath})}}]},finish_reason:null}]},
          {id,object:'chat.completion.chunk',created,model:'fixture-model',choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}},
        ]
      : [
          {id,object:'chat.completion.chunk',created,model:'fixture-model',choices:[{index:0,delta:{role:'assistant',content:`fixture response ${call}`},finish_reason:null}]},
          {id,object:'chat.completion.chunk',created,model:'fixture-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}},
        ];
    const text=chunks.map((payload)=>`data: ${JSON.stringify(payload)}\n\n`).join('')+'data: [DONE]\n\n';
    res.writeHead(200, {'content-type':'text/event-stream'}); res.end(text);
  });
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',()=>resolve(undefined)).on('error',reject));
  return {server,requests,url:`http://127.0.0.1:${server.address().port}/v1`};
}
async function fixtureEnv(base, url) {
  const home=await mkdtemp(join(tmpdir(),'zcode-runtime-smoke-'));
  const data=join(home,'data'); await mkdir(join(data,'.zcode','v2'),{recursive:true});
  const personal={schemaVersion:1,config:{providerConfigRules:{providerRules:[{providerId:'fixture',providerName:'Fixture',templateId:null,config:{group:'standard-personal',access:{type:'api-key',apiKey:'fixture-key'},api:{type:'openai-chat-completions',baseUrl:url},personalModelIds:['fixture-model'],modelOrder:['fixture-model']}}]},modelConfigRules:{providerModelRules:[{providerId:'fixture',modelId:'fixture-model',config:{enabled:true,properties:{contextWindow:200000,supportsToolCall:true,supportsJsonSchemaOutput:false,supportsNativeWebSearch:false,supportsMidConversationSystem:false,requiresMfjsToolSchema:false,inputFormat:{supportsText:true,supportsImage:false,supportsVideo:false,supportsAudio:false,supportsPdf:false},outputFormat:{supportsText:true}},optionSpecs:{reasoningLevel:{values:['disabled','enabled'],map:'{}'},maxOutputTokens:{max:32000,map:'{}'}}}}],manualProviderModelRules:[]},defaultModelSelection:{providerId:'fixture',modelId:'fixture-model',options:{reasoningLevel:'disabled'}}}};
  const personalPath=join(data,'.zcode','v2','provider_config.json'); await writeFile(personalPath,JSON.stringify(personal));
  const storage=join(home,'storage');
  const inheritedKeys=['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','ComSpec','COMSPEC','TEMP','TMP','NUMBER_OF_PROCESSORS'];
  const inherited=Object.fromEntries(inheritedKeys.flatMap((key)=>process.env[key] === undefined ? [] : [[key,process.env[key]]]));
  return {home,env:{...inherited,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,ZCODE_DATA_BASE_DIR:data,ZCODE_STORAGE_DIR:storage,ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:base,ZCODE_PERSONAL_PROVIDER_CONFIG_FILE:personalPath,ZCODE_LOG_DIR:join(home,'logs'),NODE_ENV:'test'}};
}
function run(env,...args) { return new Promise((resolve)=>{const p=spawn(process.execPath,[entry,...args],{cwd:root,env,stdio:['ignore','pipe','pipe']}); let out='',err=''; p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('close',(code,signal)=>resolve({code,signal,out,err}));}); }

test('fixture provider appears in models', async () => {
  const f = await serverFixture('C:/fixture.txt');
  const e = await fixtureEnv(builtin, f.url);
  try {
    const r = await run(e.env, 'models', '--json');
    assert.equal(r.code, 0);
    assert.match(r.out, /fixture-model/);
  } finally {
    await rm(e.home, { recursive: true, force: true });
    await new Promise((resolve) => f.server.close(resolve));
  }
});

test('DeepSeek API key setup makes template models selectable', async () => {
  const f = await serverFixture('C:/deepseek-fixture.txt');
  const e = await fixtureEnv(builtin, f.url);
  try {
    await configureDeepseekApiKey({
      apiKey: 'deepseek-test-key',
      env: e.env,
      personalProviderConfigPath: e.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE,
    });
    const r = await run(e.env, 'models', '--json');
    assert.equal(r.code, 0);
    const models = JSON.parse(r.out);
    assert.ok(models.some((model) => model.provider === 'deepseek' && model.id === 'deepseek-v4-pro'));
  } finally {
    await rm(e.home, { recursive: true, force: true });
    await new Promise((resolve) => f.server.close(resolve));
  }
});



test('fixture provider completes real tool loop', async()=>{
  const home=await mkdtemp(join(tmpdir(),'zcode-runtime-smoke-case-'));
  const target=join(home,'fixture.txt'); await writeFile(target,'fixture nonce ZCODE-SMOKE-7\n');
  const f=await serverFixture(target); const e=await fixtureEnv(builtin,f.url); e.env.ZCODE_STORAGE_DIR=join(e.home,'storage');
  try {
    const prompt=`Read ${target} and report the nonce exactly.`;
    const r=await run(e.env,'run',prompt,'--output-format','stream-json');
    const second=JSON.stringify(f.requests[1]?.body ?? {});
     assert.equal(r.code,0); assert.match(r.out,/fixture response 2/); assert.ok(f.requests.length >= 2);
     const streamLines = r.out.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
     assert.equal(streamLines[0]?.type, 'session');
     assert.equal(streamLines.at(-1)?.type, 'result');
    assert.equal(f.requests[0].body.model,'fixture-model'); assert.ok(Array.isArray(f.requests[0].body.tools));
    assert.match(second,/ZCODE-SMOKE-7/);
  } finally {
    await rm(e.home,{recursive:true,force:true}); await rm(home,{recursive:true,force:true}); await new Promise(res=>f.server.close(res));
  }
});



test('session survives explicit resume and latest-session continuation', async()=>{
  const home=await mkdtemp(join(tmpdir(),'zcode-runtime-smoke-session-'));
  const target=join(home,'fixture.txt'); await writeFile(target,'fixture nonce ZCODE-RESUME-9\n');
  const f=await serverFixture(target); const e=await fixtureEnv(builtin,f.url);
  try {
    const first=await run(e.env,'run',`Read ${target} and report the nonce exactly.`,'--output-format','stream-json');
    assert.equal(first.code,0);
    const firstResult=first.out.split(/\r?\n/u).map((line)=>{try{return JSON.parse(line)}catch{return null}}).find((line)=>line?.type==='result');
    assert.ok(firstResult?.sessionId,'first run must emit a session id');
    const sessionId=String(firstResult.sessionId);
    const resumed=await run(e.env,'run','Continue from the previous answer and say RESUMED-OK.','--resume',sessionId,'--output-format','stream-json');
    assert.equal(resumed.code,0); assert.match(resumed.out,/fixture response 3/);
    const resumedRequest=f.requests[2]?.body;
    assert.equal(resumedRequest?.messages?.[resumedRequest.messages.length-1]?.content,'Continue from the previous answer and say RESUMED-OK.');
    assert.match(JSON.stringify(resumedRequest),/ZCODE-RESUME-9/);
    const continued=await run(e.env,'run','Continue once more and say CONTINUED-OK.','--continue','--output-format','stream-json');
    assert.equal(continued.code,0); assert.match(continued.out,/fixture response 4/);
    assert.match(JSON.stringify(f.requests[3]?.body),/RESUMED-OK/);
  } finally {
    await rm(e.home,{recursive:true,force:true}); await rm(home,{recursive:true,force:true}); await new Promise(res=>f.server.close(res));
  }
});


async function delayedFixture() {
  const requests=[]; let firstRequestResolve; const firstRequest=new Promise((resolve)=>{firstRequestResolve=resolve});
  const server=createServer(async(req,res)=>{
    const body=await readBody(req); requests.push({method:req.method,url:req.url,body:JSON.parse(body)}); res.writeHead(200,{'content-type':'text/event-stream'}); res.flushHeaders(); firstRequestResolve(req);
    await new Promise((resolve)=>req.on('aborted',resolve).on('close',resolve));
  });
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',()=>resolve(undefined)).on('error',reject));
  return {server,requests,firstRequest,url:`http://127.0.0.1:${server.address().port}/v1`};
}
function spawnRun(env,...args) {
  const child=spawn(process.execPath,[entry,...args],{cwd:root,env,stdio:['ignore','pipe','pipe']}); let out='',err='';
  child.stdout.on('data',(chunk)=>{out+=chunk}); child.stderr.on('data',(chunk)=>{err+=chunk});
  const closed=new Promise((resolve)=>child.on('close',(code,signal)=>resolve({code,signal,out,err})));
  return {child,closed};
}

test('SIGINT terminates the CLI with an in-flight model request', async()=>{
  const f=await delayedFixture(); const e=await fixtureEnv(builtin,f.url);
  try {
    const running=spawnRun(e.env,'run','Stay in this turn until cancelled.','--output-format','stream-json');
    await Promise.race([f.firstRequest,new Promise((_,reject)=>setTimeout(()=>reject(new Error('fixture request timeout')),10000))]);
    running.child.kill('SIGINT');
    const result=await Promise.race([running.closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('CLI did not exit after SIGINT')),10000))]);
    assert.notEqual(result.code,0); assert.match(result.out+result.err,/Interrupted|interrupt|abort|cancel/i);
  } finally {
    await rm(e.home,{recursive:true,force:true}); await new Promise(res=>f.server.close(res));
  }
});


test('source run wires AbortSignal into a real AgentRuntime turn', async () => {
  const f = await delayedFixture();
  const e = await fixtureEnv(builtin, f.url);
  const stdout = { value: '', write(chunk) { this.value += String(chunk); } };
  const stderr = { value: '', write(chunk) { this.value += String(chunk); } };
  const listeners = new Map();
  const shutdownProcess = {
    platform: 'win32',
    once(signal, listener) { listeners.set(signal, listener); },
    off(signal) { listeners.delete(signal); },
  };
  let exitCode;
  try {
    const running = runSource(
      { argv: ['run', 'Stay in this turn until cancelled.', '--output-format', 'stream-json'], stdin: process.stdin, stdout, stderr },
      {
        env: e.env,
        cwd: () => root,
        createZCodeApp,
        mapSessionEvent,
        startProcessProviderRegistryRuntime,
        shutdownProcess,
        exitProcess: (code) => { exitCode = code; },
      },
    );
    await Promise.race([f.firstRequest, new Promise((_, reject) => setTimeout(() => reject(new Error('fixture request timeout')), 10000))]);
    listeners.get('SIGINT')?.();
    const result = await Promise.race([running, new Promise((_, reject) => setTimeout(() => reject(new Error('source run did not settle after SIGINT')), 10000))]);
    assert.equal(exitCode, 130);
    assert.notEqual(result, 0);
    assert.match(`${stdout.value}${stderr.value}`, /SIGINT|interrupted|abort|cancel/i);
  } finally {
    await rm(e.home, { recursive: true, force: true });
    await new Promise((resolve) => f.server.close(resolve));
  }
});
