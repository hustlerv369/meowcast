import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCatCompanion, neutralCatPalette } from '../src/mochi/cat.ts';
test('neutral cat keeps opposite ink and body for both themes', () => {
  assert.deepEqual(neutralCatPalette('#F5F5F5'), {body:'#505050',ink:'#F5F5F5'});
  assert.deepEqual(neutralCatPalette('#202020'), {body:'#D0D0D0',ink:'#202020'});
});
test('explicit shared theme wins over stale OS-derived ink', () => {
  globalThis.document={documentElement:{dataset:{theme:'light'}}};
  assert.equal(neutralCatPalette('#202020').body,'#505050');
  document.documentElement.dataset.theme='dark';
  assert.equal(neutralCatPalette('#F5F5F5').body,'#D0D0D0');
  delete globalThis.document;
});
test('full body remains neutral and removes inherited glow at each DPR', () => {
  globalThis.Path2D = class { constructor(path) { this.path=path; } };
  for(const dpr of [1,1.25,2,3]) {
    const colors=[]; const scales=[];
    const context={save(){},restore(){},translate(){},scale(x,y){scales.push([x,y]);},fill(){colors.push(this.fillStyle);},stroke(){colors.push(this.strokeStyle);},shadowBlur:18,shadowColor:'red'};
    drawCatCompanion(context,30*dpr,'calm','#FF00FF','#202020');
    assert.ok(colors.every(color=>['#D0D0D0','#202020'].includes(color)));
    assert.deepEqual(scales[0],[dpr,dpr]);
    assert.equal(context.shadowBlur,0);
    assert.equal(context.shadowColor,'transparent');
  }
  delete globalThis.Path2D;
});
