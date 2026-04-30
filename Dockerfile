FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY ecosystem.config.cjs ./ecosystem.config.cjs

EXPOSE 4010

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 CMD node -e "const port=process.env.RUMBLE_BOT_HTTP_PORT||process.env.BOT_HTTP_PORT||4010; fetch(`http://127.0.0.1:${port}/health`).then((res)=>process.exit(res.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
