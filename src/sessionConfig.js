import session from 'express-session';

export const sessionConfig = session({
  secret: 'your-secret-key', // Replace with a secure secret
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
});