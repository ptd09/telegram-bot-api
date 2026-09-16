#!/bin/bin/sh

# 1. Chạy Telegram Bot API Server ngầm ở cổng nội bộ 8081
telegram-bot-api --local --http-port=8081 --dir=/tmp --api-id=$TELEGRAM_API_ID --api-hash=$TELEGRAM_API_HASH &

# 2. Chờ 2 giây cho Telegram Bot API khởi động xong
sleep 2

# 3. Ép Node.js gọi sang cổng nội bộ 8081
export TELEGRAM_SERVER_URL="http://127.0.0.1:8081"

# 4. Khởi chạy Server Node.js chính ở cổng 10000 (Giao tiếp với Render & Browser)
node server.js
