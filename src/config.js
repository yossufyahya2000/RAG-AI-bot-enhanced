import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Add CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');
    next();
});

// Serve static files
app.use(express.static(join(__dirname, '../public')));

// Parse JSON bodies
app.use(express.json());

// Handle root route
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, '../public/index.html'));
});

export { app, __dirname };
