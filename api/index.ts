// Important: when deployed on Vercel, this handler is executed in a serverless environment.
// We export a default function that delegates to the Express app.
//
// Note: The project is ESM (package.json has "type": "module").
// Vercel's Node runtime will compile this TS file.
import app from '../src/app.js';

export default function handler(req: any, res: any) {
  // Express apps are (req, res) handlers already.
  return app(req as any, res as any);
}
