import { build } from "esbuild";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import electron from "electron";
const root = await mkdtemp(join(tmpdir(), "pearl-live-browser-"));
const project = join(root, "project");
await mkdir(project);
await writeFile(
  join(project, "server.cjs"),
  `const http=require('http'),fs=require('fs');http.createServer((req,res)=>{if(req.method==='POST'){let body='';req.on('data',v=>body+=v);req.on('end',()=>{fs.writeFileSync('saved.txt',new URLSearchParams(body).get('note')+' '+new URLSearchParams(body).get('kind'));res.writeHead(303,{Location:'/saved'});res.end()});return}res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Preview</title>'+ (req.url==='/saved'?'<h1>Saved '+fs.readFileSync('saved.txt','utf8')+'</h1>':'<form hidden><input name=note></form><form id=active method=post action=/save><label>Note<input name=note></label><select name=kind><option value=plain>Plain</option><option value=special>Special</option></select><button>Save</button></form>'))}).listen(Number(process.env.PORT),process.env.HOST);`,
);
const outfile = join(root, "probe.cjs");
try {
  await build({
    stdin: {
      contents: `import {app} from 'electron'; import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; import {withProjectPreview,startProjectPreview} from ${JSON.stringify(resolve("src/main/pearl-preview.ts"))}; import {IsolatedPearlBrowser} from ${JSON.stringify(resolve("src/main/pearl-browser.ts"))}; app.on('window-all-closed',()=>{}); app.whenReady().then(async()=>{const browser=new IsolatedPearlBrowser(); const result=await withProjectPreview(${JSON.stringify(process.execPath)},['server.cjs'],${JSON.stringify(project)},(origin,signal)=>browser.checkLive(origin,'/',[{action:'select',selector:'select[name="kind"]',value:'special'},{action:'fill',selector:'#active input[name="note"]',value:'keyboard checked'},{action:'press',selector:'#active input[name="note"]',key:'+'},{action:'press',selector:'#active input[name="note"]',key:'/'},{action:'press',selector:'#active input[name="note"]',key:'Enter'},{action:'wait_for',selector:'h1',value:'Saved'},{action:'reload'}],signal));assert.match(result.visibleText,/Saved keyboard checked\\+\\/ special/);assert.equal(result.errors.length,0);assert.equal(result.completedSteps,7);assert.equal(readFileSync(${JSON.stringify(join(project, "saved.txt"))},'utf8'),'keyboard checked+/ special'); const partial=await withProjectPreview(${JSON.stringify(process.execPath)},['server.cjs'],${JSON.stringify(project)},(origin,signal)=>browser.checkLive(origin,'/',[{action:'fill',selector:'#active input[name="note"]',value:'partial'},{action:'press',selector:'#active input[name="note"]',key:'Enter'},{action:'click',selector:'#missing'}],signal));assert.match(partial.visibleText,/Saved partial/);assert.equal(partial.completedSteps,2);assert.match(partial.errors.join(' '),/Step 3 failed/);const running=await startProjectPreview(${JSON.stringify(process.execPath)},['server.cjs'],${JSON.stringify(project)}); try { const first=await browser.openLive('persistent',running.origin,'/',[]);const note=first.controls.find(c=>c.name==='note');assert.ok(note.selector.startsWith('#active')); const signed=await browser.continueLive('persistent',undefined,[{action:'fill',selector:note.selector,value:'retained'},{action:'press',selector:note.selector,key:'Enter'},{action:'wait_for',selector:'h1',value:'Saved'}]);assert.match(signed.visibleText,/Saved retained/);const next=await browser.continueLive('persistent',undefined,[{action:'reload'}]);assert.match(next.initialVisibleText,/Saved retained/);assert.match(next.visibleText,/Saved retained/);await assert.rejects(browser.continueLive('persistent','http://example.com',[]),/Invalid preview path/);browser.closeLive('persistent');await assert.rejects(browser.continueLive('persistent',undefined,[]),/session ended/);}finally{browser.closeLive('persistent');await running.close();}assert.equal(running.active(),false);await assert.rejects(fetch(running.origin));await assert.rejects(browser.checkLive('http://127.0.0.1:12345' ,'//example.com',[]),/Invalid preview path/);console.log('PASS: isolated live server preview submits with Enter, follows navigation, reloads persisted state and rejects external targets.');app.exit(0)}).catch(error=>{console.error(error);app.exit(1)});`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  });
  const result = await promisify(execFile)(electron, [outfile], {
    timeout: 40_000,
    maxBuffer: 100_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
  });
  assert.match(result.stdout, /PASS:/);
  process.stdout.write(result.stdout);
} finally {
  await rm(root, { recursive: true, force: true });
}
