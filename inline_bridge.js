// DEPRECATED / 已废弃：当前扩展改用 manifest.json 的 MAIN world content script 注入 page-bridge.js。
// 本脚本会重新引入被 YouTube CSP 拦截的内联 <script> 逻辑，请勿运行。
// 以下内容仅保留作历史参考。
const fs = require('fs');
const path = require('path');

const dir = 'D:/code/chrome-plug-translate';
const bridge = fs.readFileSync(path.join(dir, 'page-bridge.js'), 'utf8');
const content = fs.readFileSync(path.join(dir, 'content.js'), 'utf8');

// 1. 在 content.js 顶部（IIFE 之后）插入 BRIDGE_SOURCE 常量
// 用 JSON.stringify 安全转义 bridge 源码
const bridgeConst = `\n// 内联的 page-bridge.js 源码（构建时由 inline_bridge.js 生成）\n// 用内联字符串 + TrustedScript 注入，彻底绕过 YouTube CSP 与 fetch 限制\nconst BRIDGE_SOURCE = ${JSON.stringify(bridge)};\n`;

// 2. 找到 IIFE 开头（"use strict"; 之后）插入
const marker = `  'use strict';
  if (window.__dshYtSubLoaded) return;
  window.__dshYtSubLoaded = true;
`;
const insertAfter = marker;

if (content.indexOf(bridgeConst.trim()) >= 0) {
  console.log('BRIDGE_SOURCE 已存在，跳过');
  process.exit(0);
}

const newContent = content.replace(insertAfter, insertAfter + bridgeConst);

fs.writeFileSync(path.join(dir, 'content.js'), newContent, 'utf8');
console.log('已内联 page-bridge.js 到 content.js');
console.log('  bridge 源码长度:', bridge.length);
console.log('  content.js 新长度:', newContent.length);
