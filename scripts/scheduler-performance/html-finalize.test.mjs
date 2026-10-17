import test from "node:test";
import assert from "node:assert/strict";
import {finalizeHtml,MAIN_POLICY,PLANNER_POLICY} from "./html-finalize.mjs";
test("both preview policies are installed before scripts for recognized head variants",()=>{
 for(const head of ['<head>','<head lang="en">','<HEAD>','<head\n lang="en"\n>']) for(const policy of [MAIN_POLICY,PLANNER_POLICY]) {
  const out=finalizeHtml(`<!doctype html><html>${head}<script src="app.js"></script></head><body></body></html>`,policy);
  assert.ok(out.indexOf("connect-src 'none'")<out.indexOf('<script'));
  assert.ok(out.includes(`content="${policy}"`));
  assert.equal(finalizeHtml(out,policy),out);
 }
});
test("missing, duplicate, reversed and malformed heads or altered policies fail closed",()=>{
 for(const html of ['<html><body></body></html>','<head><script></script>','<head lang="en></head>','</head><head>','<head></head><head></head>','<head lang="en"<script></script></head>','<script></script><head></head>']) assert.throws(()=>finalizeHtml(html,MAIN_POLICY));
 assert.throws(()=>finalizeHtml('<head><meta http-equiv="Content-Security-Policy" content="connect-src *"></head>',MAIN_POLICY));
});
