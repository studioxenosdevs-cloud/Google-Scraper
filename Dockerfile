FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 7860
ENV PORT=7860

CMD ["node", "server.js"]
