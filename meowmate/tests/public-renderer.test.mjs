import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {UploadSeq} from '../src/upload/sequence.ts';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('public cat engine contains no inherited choreography or particle renderer',()=>{
 const engine=source('src/mochi/engine.ts');
 assert.match(engine,/drawCatCompanion/);
 assert.match(engine,/prefers-reduced-motion/);
 assert.doesNotMatch(engine,/waveUntil|waveStart|EMOTE_EYE|drawParticles|miniNextBehavior|slapTimes/);
});
test('attachment state remains finite and can be cancelled',()=>{
 UploadSeq.performDrop(0);assert.equal(UploadSeq.isActive,true);assert.equal(UploadSeq.dropped,true);
 assert.ok(Number.isFinite(UploadSeq.frame().progress));
 UploadSeq.deactivate();assert.equal(UploadSeq.isActive,false);assert.equal(UploadSeq.sinceDrop(),null);
});
test('public export does not fetch restricted upstream sound assets',()=>{
 assert.doesNotMatch(source('src/core/sound.ts'),/fetch\(|decodeAudioData/);
 assert.doesNotMatch(source('vite.config.ts'),/NotchBuddy|SOUNDS_DIR|sharedSounds/);
});
test('native unit tests do not depend on private external QA files',()=>{
 assert.doesNotMatch(source('src-tauri/src/work.rs'),/\.\.\/\.\.\/\.\.\/qa/);
});
