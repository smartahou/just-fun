'use strict';
// Migration-only golden check: intentionally must be reviewed/updated after
// future intentional feature changes. DO NOT normalize mismatches away.
const fs=require('node:fs'), path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const before=fs.readFileSync(path.join(__dirname,'reference/v6.21.douyin.js'),'utf8');
const after=fs.readFileSync(path.join(root,'dist/douyin.js'),'utf8');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const split=(s)=>{
  const a=s.indexOf('function htmlPage() {');
  const b=s.indexOf('function mimeForAsset(',a);
  assert.ok(a>0&&b>a,'htmlPage or next server function missing');
  return {pre:s.slice(0,a),post:s.slice(b)};
};
const x=split(before),y=split(after);
assert.equal(x.pre,y.pre,'Server bootstrap/security/catalog/http/media prefix changed');
assert.equal(x.post,y.post,'Server processing/routes/lifecycle suffix changed');
const report=JSON.parse(fs.readFileSync(path.join(root,'dist/build-report.json'),'utf8'));
assert.ok(!report.baselinePageIdentical,'Expected intentional v6.22 UI changes, but HTML still matches v6.21');
assert.ok(after.includes('jfAppSplash') && after.includes('jfPreviewVisible'),'v6.22 UI changes missing from built output');
console.log('PASS: all backend code outside htmlPage byte-for-byte identical to v6.21');
console.log('PASS: intentional v6.22 UI changes present; HTML golden check intentionally replaced');
console.log('PASS: new dist source SHA256',sha(after));
