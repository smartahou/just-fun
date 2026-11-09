#!/usr/bin/env node
'use strict';
// v7.113: isolated per-row tables may not independently size their columns.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const engine=fs.readFileSync(path.join(root,'src/client/scripts/98d-page-engine.js'),'utf8');
const reader=fs.readFileSync(path.join(root,'src/client/scripts/99-reading.js'),'utf8');
const pkg=require('../package.json');
const [major,minor]=pkg.version.split('.').map(Number);
assert(major>7||(major===7&&minor>=113),'v7.113 column-grid contract survives later versions');
for(const clause of [
 "function commentaryRowFragments(item,host)",
 "host.replaceChildren(original)",
 "measured/span*100",
 "var group=document.createElement('colgroup')",
 "part.insertBefore(group,part.firstChild)",
 "part.style.setProperty('table-layout','fixed','important')",
 "part.style.setProperty('width','100%','important')",
 "var parts=commentaryRowFragments(next,host)",
 "var rows=commentaryRowFragments(item,host)"
])assert(engine.includes(clause),'Missing fixed full-table column-grid contract: '+clause);
assert(engine.includes('jfPrintSourceRowPart')&&engine.includes(
  "measure(el,host)<=pageH+EPS"),
  'normal citation/commentary row is atomic when it fits an empty leaf');
assert(reader.includes("const jfDeskFolioCacheRevision='v7.114.0'"),
  'new pagination invalidates stale verified folios');
console.log('PASS v7.113: one original measured colgroup across independent source-commentary row fragments');
