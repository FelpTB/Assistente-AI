# Build do agente do WhatsApp (pasta agent/). Usado pelo Railway.
FROM node:22-slim AS build
WORKDIR /app
COPY agent/package*.json ./
RUN npm ci
COPY agent/tsconfig.json ./
COPY agent/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY agent/package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
