import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'body-parser';
import { env } from './config/env';
import { AppError } from './shared/errors/AppError';
import routes from './interfaces/http/routes';

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

  // Error handling middleware
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        status: 'error',
        message: err.message,
      });
    }

    console.error('Unexpected error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  });

  return app;
};