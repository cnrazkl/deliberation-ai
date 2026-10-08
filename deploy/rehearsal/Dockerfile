FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN npm install --global pnpm@11.19.0 && chown node:node /app
COPY --chown=node:node . .
USER node
RUN pnpm install --frozen-lockfile && pnpm typecheck && pnpm build
RUN mkdir -p /app/.local
CMD ["pnpm", "--filter", "@deliberation-ai/web", "exec", "next", "start", "--hostname", "0.0.0.0"]
