import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'body-parser';
import { env } from './config/env';
import routes from './interfaces/http/routes';
import { errorHandler } from './interfaces/http/middlewares/errorHandler';

export const createApp = async (): Promise<Application> => {
  const app = express();

  // Middlewares base
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    })
  );
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true }));
  app.use(cookieParser());

  // API Routes
  app.use('/api', routes);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Error handling middleware. Se usa el handler compartido (que además traduce
  // ZodError a 400) en vez de duplicar la lógica acá.
  app.use(errorHandler);

  return app;
};