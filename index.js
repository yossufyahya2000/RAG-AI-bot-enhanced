import { app } from './src/config.js';
import './src/routes.js';

// For Vercel, we need to export the app
export default app;

// Only listen if not running on Vercel
if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
