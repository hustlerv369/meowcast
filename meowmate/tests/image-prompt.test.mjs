import test from 'node:test';
import assert from 'node:assert/strict';
import { improveImagePrompt, validateImageReference, ImageReferencePreview } from '../src/core/image-prompt.ts';
const png = () => new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'reference.png', {type:'image/png'});
test('offline prompt preserves brief and only adds reference instructions when selected', () => {
  const brief = '<script>text</script> Red cat without lettering.';
  assert.ok(improveImagePrompt(brief, 'Keep my style', '16:9', false).includes(brief));
  assert.ok(!improveImagePrompt(brief, 'Keep my style', 'Auto', false).includes('I attach'));
  assert.ok(improveImagePrompt(brief, 'Illustration', '1:1', true).includes('I attach'));
  assert.throws(() => improveImagePrompt(' ', '', '', false));
  assert.throws(() => improveImagePrompt('x'.repeat(8000), '', '', false));
});
test('reference rejects empty, oversized, spoofed and unsupported files', async () => {
  await validateImageReference(png());
  for (const file of [new File([], 'empty.png', {type:'image/png'}), new File(['fake'], 'fake.png', {type:'image/png'}), new File(['<svg/>'], 'x.svg', {type:'image/svg+xml'})]) {
    await assert.rejects(validateImageReference(file));
  }
  await assert.rejects(validateImageReference({size:10*1024*1024+1}));
});
test('replace/remove revoke object URLs and an obsolete pending selection cannot reappear', async () => {
  const revoked=[]; let sequence=0;
  const preview = new ImageReferencePreview({createObjectURL:()=>`blob:${++sequence}`,revokeObjectURL:url=>revoked.push(url)});
  await preview.set(png()); await preview.set(png());
  assert.deepEqual(revoked,['blob:1']);
  preview.clear(); assert.equal(preview.url,''); assert.deepEqual(revoked,['blob:1','blob:2']);
  const pending=preview.set(png()); preview.clear();
  assert.equal(await pending,false); assert.equal(preview.url,'');
});
