#!/usr/bin/env node

/**
 * 邮箱检查脚本
 * 支持 Gmail, Outlook, QQ邮箱等 IMAP 服务
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, 'email-config.json');
const LOG_FILE = path.join(__dirname, 'email-check.log');

// 日志函数
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());
  fs.appendFileSync(LOG_FILE, logMessage);
}

// 读取配置
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    log('错误: 配置文件不存在，请创建 email-config.json');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

// 检查邮箱
async function checkEmail() {
  const config = loadConfig();
  
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.email,
      password: config.password,
      host: config.host,
      port: config.port || 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    imap.once('ready', () => {
      log('已连接到邮箱服务器');
      
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          log(`错误: ${err.message}`);
          imap.end();
          reject(err);
          return;
        }

        log(`收件箱总邮件数: ${box.messages.total}`);
        log(`未读邮件数: ${box.messages.unseen}`);

        if (box.messages.unseen === 0) {
          log('没有未读邮件');
          imap.end();
          resolve({ total: box.messages.total, unseen: 0, emails: [] });
          return;
        }

        // 获取未读邮件
        const fetch = imap.seq.fetch(`${Math.max(1, box.messages.total - 9)}:*`, {
          bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
          struct: true
        });

        const emails = [];

        fetch.on('message', (msg, seqno) => {
          msg.on('body', (stream, info) => {
            simpleParser(stream, (err, parsed) => {
              if (!err && parsed) {
                emails.push({
                  from: parsed.from?.text || '未知',
                  subject: parsed.subject || '无主题',
                  date: parsed.date || new Date()
                });
              }
            });
          });
        });

        fetch.once('error', (err) => {
          log(`获取邮件错误: ${err.message}`);
          reject(err);
        });

        fetch.once('end', () => {
          log('邮件检查完成');
          if (emails.length > 0) {
            log('\n最近的邮件:');
            emails.slice(-5).forEach((email, i) => {
              log(`  ${i + 1}. 发件人: ${email.from}`);
              log(`     主题: ${email.subject}`);
            });
          }
          imap.end();
          resolve({ total: box.messages.total, unseen: box.messages.unseen, emails });
        });
      });
    });

    imap.once('error', (err) => {
      log(`IMAP 错误: ${err.message}`);
      reject(err);
    });

    imap.once('end', () => {
      log('已断开连接\n');
    });

    imap.connect();
  });
}

// 主函数
async function main() {
  log('=== 开始检查邮箱 ===');
  try {
    await checkEmail();
  } catch (error) {
    log(`检查失败: ${error.message}`);
    process.exit(1);
  }
}

main();
