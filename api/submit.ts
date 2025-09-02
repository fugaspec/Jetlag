{
  "name": "jetlag-app",
  "version": "1.0.0",
  "description": "Jet Lag Notification App",
  "main": "index.js",
  "type": "commonjs",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  },
  "dependencies": {
    "luxon": "^3.3.0",
    "nodemailer": "^6.9.3",
    "@upstash/redis": "^1.20.0"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  },
  "author": "Shinnosuke",
  "license": "MIT"
}