FROM aiogram/telegram-bot-api:latest
EXPOSE 10000
CMD ["--local", "--http-port=10000", "--dir=/tmp"]
