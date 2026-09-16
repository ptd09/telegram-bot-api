FROM aiogram/telegram-bot-api:latest

# Cổng kết nối
EXPOSE 10000

# Khai báo các biến môi trường bắt buộc
ENV TELEGRAM_API_ID=""
ENV TELEGRAM_API_HASH=""

# Lệnh khởi chạy với chế độ local server
CMD ["--local", "--http-port=10000", "--dir=/tmp"]
