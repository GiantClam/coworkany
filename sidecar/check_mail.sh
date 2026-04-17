#!/bin/bash
# 邮件检查脚本
LOG_FILE="$HOME/mail_check.log"
echo "=== $(date) ===" >> "$LOG_FILE"
echo "q" | mail >> "$LOG_FILE" 2>&1
echo "" >> "$LOG_FILE"
