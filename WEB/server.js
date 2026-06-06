import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 5005;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use('/nfc', express.static(path.join(__dirname, 'public/nfc')));
app.use(express.static(path.join(__dirname, 'public')));

// Database Layer State
let isPostgres = false;
let pgPool = null;
let sqliteDb = null;

// Abstraction Layer for executing queries
// dbGet - returns a single row or null
async function dbGet(query, params = []) {
  const sql = isPostgres ? convertQueryPlaceholders(query) : query;
  if (isPostgres) {
    const res = await pgPool.query(sql, params);
    return res.rows[0] || null;
  } else {
    const row = await sqliteDb.get(sql, params);
    return row || null;
  }
}

// dbRun - runs an insert/update/delete command
async function dbRun(query, params = []) {
  const sql = isPostgres ? convertQueryPlaceholders(query) : query;
  if (isPostgres) {
    await pgPool.query(sql, params);
  } else {
    await sqliteDb.run(sql, params);
  }
}

// dbAll - returns all matching rows
async function dbAll(query, params = []) {
  const sql = isPostgres ? convertQueryPlaceholders(query) : query;
  if (isPostgres) {
    const res = await pgPool.query(sql, params);
    return res.rows;
  } else {
    return await sqliteDb.all(sql, params);
  }
}

// Helper to convert "?" placeholders to PostgreSQL "$1, $2..." placeholders
function convertQueryPlaceholders(query) {
  let index = 1;
  return query.replace(/\?/g, () => `$${index++}`);
}

// Initialize Active Database (Neon pg or SQLite fallback)
async function initDb() {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    console.log('Connecting to Neon PostgreSQL Database...');
    const { Pool } = pg;
    pgPool = new Pool({
      connectionString: dbUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });
    isPostgres = true;

    // Test connection
    await pgPool.query('SELECT NOW()');
    console.log('Neon PostgreSQL connected successfully.');

    // Initialize tables using PostgreSQL syntax
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL
      );
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        email VARCHAR(255) PRIMARY KEY,
        profile_data TEXT NOT NULL
      );
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS history_events (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        action VARCHAR(255) NOT NULL,
        details TEXT NOT NULL,
        icon VARCHAR(50),
        color VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('PostgreSQL tables initialized.');
  } else {
    console.log('No DATABASE_URL found. Falling back to local SQLite...');
    sqliteDb = await open({
      filename: path.join(__dirname, 'database.sqlite'),
      driver: sqlite3.Database
    });
    isPostgres = false;

    // Initialize tables using SQLite syntax
    await sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        email TEXT PRIMARY KEY,
        profile_data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS history_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('SQLite Database initialized successfully.');
  }
}

// Seed data template (Abhinand's original data)
const defaultProfile = {
  name: "Abhinand",
  tagline: "Let's connect!",
  diamonds: "12000",
  avatar: "/profile_avatar.png",
  isOnline: true,
  tags: [
    { text: "UI/UX Designer", type: "role" },
    { text: "Digital Creator", type: "role" },
    { text: "Bangalore, India", type: "location" }
  ],
  bio: "I design meaningful experiences that connect brands with people.",
  socials: [
    {
      platform: "Instagram",
      handle: "@abhinand.designs",
      url: "https://instagram.com/abhinand.designs",
      icon: "Instagram",
      color: "#E1306C"
    },
    {
      platform: "LinkedIn",
      handle: "Abhinand Kumar",
      url: "https://linkedin.com",
      icon: "Linkedin",
      color: "#0077B5"
    },
    {
      platform: "Telegram",
      handle: "@abhinand_uiux",
      url: "https://t.me/abhinand_uiux",
      icon: "Send",
      color: "#0088cc"
    },
    {
      platform: "WhatsApp",
      handle: "Chat with me",
      url: "https://wa.me",
      icon: "MessageCircle",
      color: "#25D366"
    },
    {
      platform: "Download My CV / Resume",
      handle: "View & Download",
      url: "#",
      icon: "FileText",
      color: "#A259FF"
    },
    {
      platform: "Portfolio Link",
      handle: "abhinand.design",
      url: "https://abhinand.design",
      icon: "Link",
      color: "#6366F1"
    },
    {
      platform: "Behance",
      handle: "behance.net/abhinand",
      url: "https://behance.net/abhinand",
      icon: "Globe",
      color: "#0057ff"
    }
  ],
  quote: {
    text: "Design is not just what it looks like, it's how it connects.",
    signature: "Abhinand"
  },
  isPremium: false,
  tapCount: 0
};

// Score calculation logic based on completeness and subscription tier
function calculateScore(profile) {
  const tapCount = isNaN(parseInt(profile.tapCount)) ? 0 : parseInt(profile.tapCount);
  
  // Checklist eligibility verification
  const hasAvatar = profile.avatar && profile.avatar !== "/profile_avatar.png" && profile.avatar !== "";
  const hasBio = profile.bio && profile.bio.trim() !== "";
  const hasTags = profile.tags && profile.tags.some(t => t.text && t.text.trim() !== "");
  const hasQuote = profile.quote && profile.quote.text && profile.quote.text.trim() !== "";
  
  // Count connected socials (exclude default values or empty handles)
  const connectedSocials = profile.socials ? profile.socials.filter(s => {
    if (!s.handle || s.handle.trim() === "") return false;
    if (s.handle === "Chat with me" || s.handle === "View & Download" || s.handle === "abhinand.design" || s.handle.includes("abhinand")) {
      return false;
    }
    return true;
  }).length : 0;

  const completionBoost = 
    (hasAvatar ? 2000 : 0) + 
    (hasBio ? 1500 : 0) + 
    (hasTags ? 1500 : 0) + 
    (hasQuote ? 1000 : 0) + 
    (connectedSocials >= 3 ? 1500 : 0);

  const premiumBoost = profile.isPremium ? 5000 : 0;

  return tapCount + completionBoost + premiumBoost;
}

// Verification function for leaderboard eligibility
function satisfiesLeaderboardCriteria(profile) {
  if (!profile.isPremium) return false;
  
  const hasAvatar = profile.avatar && profile.avatar !== "/profile_avatar.png" && profile.avatar !== "";
  const hasBio = profile.bio && profile.bio.trim() !== "";
  const hasTags = profile.tags && profile.tags.some(t => t.text && t.text.trim() !== "");
  
  const connectedSocials = profile.socials ? profile.socials.filter(s => {
    if (!s.handle || s.handle.trim() === "") return false;
    if (s.handle === "Chat with me" || s.handle === "View & Download" || s.handle === "abhinand.design" || s.handle.includes("abhinand")) {
      return false;
    }
    return true;
  }).length : 0;

  return hasAvatar && hasBio && hasTags && connectedSocials >= 3;
}

// API Routes

// Register
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    // Check if email exists
    const existingUser = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered.' });
    }

    // Insert user
    await dbRun(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email.toLowerCase(), password]
    );

    // Initialize user profile
    const userProfile = {
      ...defaultProfile,
      name: name,
      socials: defaultProfile.socials.map(s => {
        let handle = s.handle;
        if (s.platform === "LinkedIn") handle = name;
        if (s.platform === "Instagram") handle = `@${name.toLowerCase().replace(/\s+/g, "")}`;
        if (s.platform === "Telegram") handle = `@${name.toLowerCase().replace(/\s+/g, "")}_ux`;
        if (s.platform === "Portfolio Link") handle = `${name.toLowerCase().replace(/\s+/g, "")}.design`;
        return { ...s, handle };
      }),
      quote: {
        text: "Design is not just what it looks like, it's how it connects.",
        signature: name
      }
    };

    await dbRun(
      'INSERT INTO profiles (email, profile_data) VALUES (?, ?)',
      [email.toLowerCase(), JSON.stringify(userProfile)]
    );

    res.status(201).json({ success: true, user: { name, email: email.toLowerCase() } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error occurred during registration.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await dbGet(
      'SELECT * FROM users WHERE email = ? AND password = ?',
      [email.toLowerCase(), password]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    res.json({ success: true, user: { name: user.name, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error occurred during login.' });
  }
});

// Get Profile by email
app.get('/api/profile/:email', async (req, res) => {
  const { email } = req.params;

  try {
    const profile = await dbGet('SELECT * FROM profiles WHERE email = ?', [email.toLowerCase()]);
    if (!profile) {
      // Revert to Abhinand's default profile
      return res.json(defaultProfile);
    }
    res.json(JSON.parse(profile.profile_data));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile details.' });
  }
});

// Update Profile
app.put('/api/profile', async (req, res) => {
  const { email, profileData } = req.body;

  if (!email || !profileData) {
    return res.status(400).json({ error: 'Email and profile data are required.' });
  }

  try {
    // Check if user exists
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    // Calculate total score based on criteria
    const totalScore = calculateScore(profileData);
    profileData.diamonds = totalScore.toString();

    // Update profile
    await dbRun(
      'INSERT INTO profiles (email, profile_data) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET profile_data = excluded.profile_data',
      [email.toLowerCase(), JSON.stringify(profileData)]
    );

    res.json({ success: true, diamonds: profileData.diamonds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile details.' });
  }
});

// Record connection history event
app.post('/api/history', async (req, res) => {
  const { email, action, details, icon, color } = req.body;
  if (!email || !action) {
    return res.status(400).json({ error: 'Email and action are required.' });
  }
  try {
    await dbRun(
      'INSERT INTO history_events (email, action, details, icon, color) VALUES (?, ?, ?, ?, ?)',
      [email.toLowerCase(), action, details || '', icon || '', color || '']
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Failed to log history event:', err);
    res.status(500).json({ error: 'Failed to record history event.' });
  }
});

// Fetch connection history events by email
app.get('/api/history/:email', async (req, res) => {
  const { email } = req.params;
  try {
    const events = await dbAll(
      'SELECT * FROM history_events WHERE email = ? ORDER BY created_at DESC LIMIT 50',
      [email.toLowerCase()]
    );
    res.json(events);
  } catch (err) {
    console.error('Failed to fetch history events:', err);
    res.status(500).json({ error: 'Failed to retrieve history events.' });
  }
});

// Public diamond score increment
app.post('/api/profile/:email/diamond', async (req, res) => {
  const { email } = req.params;
  try {
    const profile = await dbGet('SELECT * FROM profiles WHERE email = ?', [email.toLowerCase()]);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found.' });
    }
    const profileData = JSON.parse(profile.profile_data);
    
    // Increment raw tapCount
    profileData.tapCount = (isNaN(parseInt(profileData.tapCount)) ? 0 : parseInt(profileData.tapCount)) + 1;
    
    // Calculate new total score
    const totalScore = calculateScore(profileData);
    profileData.diamonds = totalScore.toString();
    
    await dbRun(
      'UPDATE profiles SET profile_data = ? WHERE email = ?',
      [JSON.stringify(profileData), email.toLowerCase()]
    );
    res.json({ success: true, diamonds: totalScore });
  } catch (err) {
    console.error('Failed to increment diamond score:', err);
    res.status(500).json({ error: 'Failed to update score.' });
  }
});

// Fetch leaderboard ranking of registered profiles
app.get('/api/leaderboard', async (req, res) => {
  try {
    const rows = await dbAll('SELECT email, profile_data FROM profiles');
    const leaders = rows.map(row => {
      try {
        const profile = JSON.parse(row.profile_data);
        if (!satisfiesLeaderboardCriteria(profile)) {
          return null;
        }
        return {
          email: row.email,
          name: profile.name,
          avatar: profile.avatar,
          diamonds: isNaN(parseInt(profile.diamonds)) ? 0 : parseInt(profile.diamonds),
          tag: profile.tags ? (profile.tags.filter(t => t.type === 'role')[0]?.text || '') : ''
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Sort by diamonds descending
    leaders.sort((a, b) => b.diamonds - a.diamonds);
    
    res.json(leaders);
  } catch (err) {
    console.error('Failed to fetch leaderboard:', err);
    res.status(500).json({ error: 'Failed to retrieve leaderboard details.' });
  }
});

// Start Server after DB init
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to connect to active DB', err);
});
