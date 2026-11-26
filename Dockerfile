# One image for every process: web (default), workers and migrations (deploy/compose.prod.yml).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Read at run time: templates and styles from src/web/ (src/web/page.ts), migrations from db/.
COPY src/web/views ./src/web/views
COPY src/web/public ./src/web/public
COPY db/migrations ./db/migrations
# The report PDF's font (src/web/reports/pdf.ts).
COPY assets/fonts ./assets/fonts
USER node
EXPOSE 3000
CMD ["node", "dist/web/server.js"]
