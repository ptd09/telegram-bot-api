FROM aiogram/telegram-bot-api:latest

# Cài đặt Node.js và npm vào container Telegram Bot API (Alpine)
USER root
RUN apk add --no-cache nodejs npm

WORKDIR /app

# Cài đặt thư viện Node.js
COPY package*.json ./
RUN npm install --production

# Copy toàn bộ mã nguồn
COPY . .

# Phân quyền thực thi cho file start.sh
RUN chmod +x /app/start.sh

# Mở cổng 10000 cho Render
EXPOSE 10000

# Chạy kịch bản khởi động kép
CMD ["/app/start.sh"]
