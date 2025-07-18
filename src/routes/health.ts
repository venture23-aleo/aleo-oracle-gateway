import express, { type Request, type Response } from 'express';

const router = express.Router();

router.get('/', (req: Request, res: Response): void => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export const healthRoutes = router;
