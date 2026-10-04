import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSharedTheme, createThemeSync} from '../src/core/theme.ts';
const value=(source,resolved=source)=>({version:1,source,resolved});
test('invalid bridge data falls back to system and explicit preferences beat OS',()=>{
 for(const bad of [null,{},value('dark','light'),{...value('dark'),key:'private'},value('script'),{...value('dark'),version:2}])assert.equal(resolveSharedTheme(bad,false),'light');
 assert.equal(resolveSharedTheme(value('light'),true),'light');
 assert.equal(resolveSharedTheme(value('dark'),false),'dark');
 assert.equal(resolveSharedTheme(value('system','light'),true),'dark');
});
test('poll updates and system events apply theme while overlapping reads are suppressed',async()=>{
 let handler; const media={matches:false,addEventListener:(_,fn)=>handler=fn,removeEventListener:()=>handler=null};
 let preference=value('system','light');let calls=0;const applied=[];
 const sync=createThemeSync(async()=>{calls++;return preference},media,v=>applied.push(v));
 await sync.refresh();media.matches=true;handler();assert.equal(applied.at(-1),'dark');
 preference=value('light');await Promise.all([sync.refresh(),sync.refresh()]);assert.equal(calls,2);assert.equal(applied.at(-1),'light');
 media.matches=true;handler();assert.equal(applied.at(-1),'light');sync.dispose();assert.equal(handler,null);
});
test('late result after disposal cannot update a closed view; read failures follow system',async()=>{
 let resolve;const applied=[]; const media={matches:true,addEventListener(){},removeEventListener(){}};
 const sync=createThemeSync(()=>new Promise(r=>resolve=r),media,v=>applied.push(v));const pending=sync.refresh();sync.dispose();resolve(value('light'));await pending;assert.deepEqual(applied,['dark']);
 const failure=createThemeSync(async()=>{throw Error('unavailable')},media,v=>applied.push(v));await failure.refresh();assert.equal(applied.at(-1),'dark');failure.dispose();
});