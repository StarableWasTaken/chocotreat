// Server για το χριστουγεννιάτικο site, φτιαγμένος για το Render.
// Δεν χρειάζονται επιπλέον πακέτα. Τοπικά τρέχει με:  node server.js

const http = require('http');

// Οι κωδικοί και το τι κερδίζει ο καθένας (δες το αρχείο codes.js)
const rawCodes = require('./codes');

// Το Render δίνει μόνο του την πόρτα μέσω της μεταβλητής PORT
const PORT = process.env.PORT || 3000;

// Η στιγμή που ανοίγει η εξαργύρωση: 25 Δεκεμβρίου 2026, 00:00 ώρα Ελλάδας (UTC+2 τον χειμώνα).
// Για να ανοίξει την 1η Ιανουαρίου, χρησιμοποίησε '2027-01-01T00:00:00+02:00'.
// Για δοκιμή μπορείς να βάλεις μεταβλητή UNLOCK_AT στο Render (ή στον υπολογιστή σου).
const UNLOCK_AT = process.env.UNLOCK_AT || '2026-12-25T00:00:00+02:00';

// Η διεύθυνση του frontend (Vercel ή Netlify), π.χ. https://to-site-mou.netlify.app
// Μόνο αυτή η σελίδα επιτρέπεται να μιλάει με τον server. Αν δεν οριστεί, επιτρέπονται όλες.
// Αφαιρούνται αυτόματα τα κενά και ο κάθετος (/) στο τέλος, γιατί ο browser τα θέλει ακριβώς όπως είναι
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '*').trim().replace(/\/+$/, '');

// Τα μηνύματα που βλέπει ο χρήστης. Άλλαξέ τα όπως θέλεις.
const LOSE_MESSAGE = 'Δεν το έτυχες! Δεν πειράζει. Καλά Χριστούγεννα!';
function winMessage(name) {
  return 'Μπράβο, ' + name + '! Κέρδισες το μυστικό δώρο! Το όνομά σου σημειώθηκε.';
}

// Βάζουμε τους κωδικούς σε έναν πίνακα με κεφαλαία γράμματα, για να μην έχει σημασία πώς θα τους γράψει κανείς
const codes = new Map();
for (const key of Object.keys(rawCodes)) codes.set(key.trim().toUpperCase(), rawCodes[key]);

// Απλός περιορισμός προσπαθειών ανά IP, για να μη δοκιμάζει κανείς πολλούς κωδικούς
const attempts = new Map();
const MAX_ATTEMPTS = 10;       // προσπάθειες
const WINDOW_MS = 60 * 1000;   // ανά ένα λεπτό

function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > MAX_ATTEMPTS;
}

// Καθάρισε τη λίστα των προσπαθειών κάθε λίγο, για να μη μεγαλώνει για πάντα
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of attempts) {
    if (list.every((t) => now - t >= WINDOW_MS)) attempts.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// Στείλε JSON πίσω στη σελίδα (με τις επιτρεπόμενες κεφαλίδες CORS)
function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN
  });
  res.end(JSON.stringify(data));
}

// Έφτασε η ώρα;
function isUnlocked() {
  return Date.now() >= new Date(UNLOCK_AT).getTime();
}

// Διάβασε το περιεχόμενο ενός αιτήματος POST, και σταμάτα αν κάποιος στείλει υπερβολικά πολλά
function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk) => {
      text += chunk;
      if (text.length > 10000) { reject(new Error('too big')); req.destroy(); }
    });
    req.on('end', () => resolve(text));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Ο browser ρωτάει πρώτα αν επιτρέπεται το αίτημα από άλλη διεύθυνση (preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // Η σελίδα ρωτάει: έχει ανοίξει η εξαργύρωση;
  if (url.pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, { unlocked: isUnlocked(), unlockAt: UNLOCK_AT });
  }

  // Κάποιος στέλνει το όνομα και τον κωδικό του
  if (url.pathname === '/api/redeem' && req.method === 'POST') {
    // Το Render περνάει τη διεύθυνση του επισκέπτη στην κεφαλίδα x-forwarded-for
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
    if (tooManyAttempts(ip)) {
      return sendJson(res, 429, { success: false, message: 'Πολλές προσπάθειες. Περίμενε ένα λεπτό και δοκίμασε ξανά.' });
    }

    // Πολύ νωρίς; Πες όχι, ακόμα κι αν ο κωδικός είναι σωστός
    if (!isUnlocked()) {
      return sendJson(res, 403, { success: false, message: 'Η εξαργύρωση δεν έχει ανοίξει ακόμα.' });
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return sendJson(res, 400, { success: false, message: 'Λάθος αίτημα.' });
    }

    // Αφαιρούμε τις αλλαγές γραμμής από το όνομα, ώστε να μη γράφει κανείς πολλές γραμμές στα logs
    const name = String(body.name || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
    const code = String(body.code || '').trim().toUpperCase();

    if (!name) return sendJson(res, 400, { success: false, message: 'Γράψε το όνομά σου.' });

    // Ο κωδικός δεν υπάρχει στη λίστα
    if (!codes.has(code)) {
      return sendJson(res, 400, { success: false, message: 'Ο κωδικός δεν είναι σωστός. Δοκίμασε ξανά.' });
    }

    const result = codes.get(code);

    // Ο τυχερός κωδικός: μόνο σε αυτή την περίπτωση γράφεται το όνομα στα logs του Render
    if (result === 'win') {
      console.log('ΝΙΚΗΤΗΣ: ' + new Date().toISOString() + ' - ' + name + ' (κωδικός ' + code + ')');
      return sendJson(res, 200, { success: true, won: true, message: winMessage(name) });
    }

    // Όλοι οι άλλοι: το απλό μήνυμα, ή δικό σου κείμενο αν έχεις γράψει κάτι άλλο στο codes.js
    const text = (result && result !== 'lose') ? String(result) : LOSE_MESSAGE;
    return sendJson(res, 200, { success: true, won: false, message: text });
  }

  sendJson(res, 404, { message: 'Δεν βρέθηκε.' });
});

server.listen(PORT, () => {
  console.log('Ο server τρέχει στην πόρτα ' + PORT);
  console.log('Η εξαργύρωση ανοίγει: ' + UNLOCK_AT);
});
