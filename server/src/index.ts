import './env';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { Server as IOServer } from 'socket.io';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../shared/protocol';
import { registerSocketHandlers, type SocketData } from './socket/handlers';
import { registerHttpRoutes } from './routes';
import { ensureAuthSchema } from './auth/schema';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;
const isProduction = process.env.NODE_ENV === 'production';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const corsOrigin = isProduction && CLIENT_ORIGIN ? CLIENT_ORIGIN : true;

const app = Fastify({ logger: { level: 'info' } });
await app.register(cors, { origin: corsOrigin });
await app.register(rateLimit, {
  global: false,
  max: 20,
  timeWindow: '1 minute',
});

registerHttpRoutes(app);

if (isProduction) {
  const clientDist =
    [resolve(process.cwd(), 'client/dist'), resolve(process.cwd(), '../client/dist')]
      .find((path) => existsSync(path)) ?? resolve(__dirname, '../../client/dist');
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/socket.io')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.log.warn({ clientDist }, 'Client build not found; serving API/socket only');
  }
}

await ensureAuthSchema();

await app.listen({ port: PORT, host: '0.0.0.0' });

const io = new IOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>(app.server, {
  cors: { origin: corsOrigin },
});

registerSocketHandlers(io);

app.log.info(`Socket.IO listening on :${PORT}`);
