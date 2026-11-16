import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db, initDatabase, UPLOAD_ROOT } from './server/db.ts';
import { realtime } from './server/realtime.ts';
import { registerApiRoutes } from './server/routes.ts';
import { initPlatformCatalogAndPurgeDemo, provisionSuperAdminProfile } from './server/seed.ts';

function cleanupExpiredStories() {
  try {
    const nowIso = new Date().toISOString();
    const expired = db.prepare('SELECT id, media_url FROM stories WHERE expires_at <= ?').all(nowIso) as {
      id: string;
      media_url: string;
    }[];

    if (expired.length === 0) return;
    const del = db.prepare('DELETE FROM stories WHERE id = ?');
    for (const s of expired) {
      del.run(s.id);
      if (s.media_url && s.media_url.startsWith('/uploads/')) {
        const rel = s.media_url.replace(/^\/uploads\//, '');
        const fullPath = path.resolve(UPLOAD_ROOT, rel);
        if (fullPath.startsWith(UPLOAD_ROOT) && fs.existsSync(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
          } catch {
            // Ignore
          }
        }
      }
    }
  } catch (err) {
    console.error('Story cleanup error:', err);
  }
}

async function startServer() {
  initDatabase();
  provisionSuperAdminProfile();
  initPlatformCatalogAndPurgeDemo();
  cleanupExpiredStories();

  // Schedule 24-hour story expiration sweep every 5 minutes
  setInterval(cleanupExpiredStories, 5 * 60 * 1000);

  const app = express();
  const server = http.createServer(app);
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Serve uploaded media buckets cleanly
  app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d' }));

  // Register API endpoints
  registerApiRoutes(app);

  // Ensure API/Multer errors always return JSON rather than dropping the connection
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
      console.error('API middleware error:', err);
      if (res.headersSent) return next(err);
      return res.status(err?.status || 400).json({ error: err?.message || 'Request error.' });
    }
    next(err);
  });

  // Initialize WebSocket Hub on the same HTTP server (port 3000)
  realtime.init(server);

  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist', 'index.html'));
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`DesiVibe server running on http://localhost:${PORT}`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

startServer();
