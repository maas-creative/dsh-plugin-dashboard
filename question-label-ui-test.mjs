import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function questionOptionLabels('),source.indexOf('function projectOptions('));
const context=vm.createContext({esc:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
vm.runInContext(helper,context);
function render(options){context.options=options;return vm.runInContext('questionOptionLabels(options)',context)}
function labels(html){return [...html.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map(match=>match[1])}
test('native labels retain exact values and accessible names with a 30-character presentation',()=>{
 const original='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';const html=render(['short','x'.repeat(30),original]);
 assert.deepEqual(labels(html),['short','x'.repeat(30),original.slice(0,27)+'...']);
 assert(html.includes('value="'+original+'" title="'+original+'" aria-label="'+original+'"'));
});
test('identical truncated prefixes remain distinct while preserving original answer identity',()=>{
 const options=['COMMON_PREFIX_012345678901234567890_LONG_CHOICE_A','COMMON_PREFIX_012345678901234567890_LONG_CHOICE_B'];const html=render(options),shown=labels(html);
 assert(shown.every(label=>label.length<=30));assert.notEqual(shown[0],shown[1]);assert(shown[0].startsWith('1. '));assert(shown[1].startsWith('2. '));for(const value of options)assert(html.includes('value="'+value+'"'));
});
test('truncation never splits a surrogate pair and native labels cannot inject markup',()=>{
 const original='a'.repeat(26)+'😀'+'b'.repeat(20);const html=render([original,'<img src=x onerror="alert(1)">']);assert.equal(labels(html)[0],'a'.repeat(26)+'...');assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('&quot;alert(1)&quot;'));
});
test('label collision counting handles duplicates and multi-digit positions without losing identity',()=>{
 const choices=Array.from({length:12},(_,i)=>'shared answer prefix '.repeat(3)+i);const shown=labels(render(choices));
 assert(shown.every(label=>label.length<=30));assert.equal(new Set(shown).size,12);assert(shown[11].startsWith('12. '));
});
