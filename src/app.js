require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { db, initDatabase } = require('../config/database');
const RoomManager = require('./websocket/RoomManager');

const app = express();
const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 3002;

// Data mappa létrehozása
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Session kezelés
app.use(session({
    secret: process.env.SESSION_SECRET || 'rikiki-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 óra
    }
}));

// Auth middleware
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}

function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.is_admin) {
        next();
    } else {
        res.status(403).send('Hozzáférés megtagadva');
    }
}

// ============== ROUTES ==============

// Login oldal
app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/lobby');
    }
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Főoldal -> login
app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/lobby');
    }
    res.redirect('/login');
});

// Lobby oldal
app.get('/lobby', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/lobby.html'));
});

// Játék oldal
app.get('/game', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/game.html'));
});

// Admin oldal
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// ============== API ROUTES ==============

// Regisztráció
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, displayName } = req.body;

        if (!username || !password || !displayName) {
            return res.status(400).json({ error: 'Minden mező kitöltése kötelező!' });
        }

        if (username.length < 3) {
            return res.status(400).json({ error: 'A felhasználónév legalább 3 karakter legyen!' });
        }

        if (password.length < 4) {
            return res.status(400).json({ error: 'A jelszó legalább 4 karakter legyen!' });
        }

        // Ellenőrzés: létezik-e már
        const existing = db.prepare('SELECT id FROM rikiki_users WHERE username = ?').get(username);

        if (existing) {
            return res.status(400).json({ error: 'Ez a felhasználónév már foglalt!' });
        }

        // Jelszó hash
        const hashedPassword = await bcrypt.hash(password, 10);

        // Felhasználó létrehozása
        db.prepare('INSERT INTO rikiki_users (username, password, display_name) VALUES (?, ?, ?)')
            .run(username, hashedPassword, displayName);

        res.json({ success: true, message: 'Sikeres regisztráció!' });

    } catch (error) {
        console.error('Regisztrációs hiba:', error);
        res.status(500).json({ error: 'Szerverhiba történt!' });
    }
});

// Bejelentkezés
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Add meg a felhasználónevet és jelszót!' });
        }

        // Felhasználó keresése
        const user = db.prepare('SELECT * FROM rikiki_users WHERE username = ?').get(username);

        if (!user) {
            return res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó!' });
        }

        // Jelszó ellenőrzés
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó!' });
        }

        // Utolsó bejelentkezés frissítése
        db.prepare('UPDATE rikiki_users SET last_login = datetime("now") WHERE id = ?').run(user.id);

        // Session beállítása
        req.session.user = {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            is_admin: user.is_admin === 1
        };

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                displayName: user.display_name,
                is_admin: user.is_admin === 1
            }
        });

    } catch (error) {
        console.error('Bejelentkezési hiba:', error);
        res.status(500).json({ error: 'Szerverhiba történt!' });
    }
});

// Kijelentkezés
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Aktuális felhasználó adatai
app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

// Ranglista
app.get('/api/leaderboard', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT
                user_id,
                user_name as display_name,
                games_played,
                games_won,
                total_score,
                highest_score,
                rank_points
            FROM rikiki_user_stats
            ORDER BY rank_points DESC
            LIMIT 50
        `).all();
        res.json(rows);
    } catch (error) {
        console.error('Ranglista hiba:', error);
        res.status(500).json({ error: 'Hiba történt' });
    }
});

// ============== ADMIN API ==============

// Beállítások lekérdezése
app.get('/api/admin/settings', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM rikiki_settings').all();
        const settings = {};
        for (const row of rows) {
            settings[row.setting_key] = row.setting_value;
        }
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: 'Hiba történt' });
    }
});

// Beállítások mentése
app.post('/api/admin/settings', requireAdmin, async (req, res) => {
    try {
        const settings = req.body;

        const updateStmt = db.prepare('UPDATE rikiki_settings SET setting_value = ? WHERE setting_key = ?');

        for (const [key, value] of Object.entries(settings)) {
            updateStmt.run(value.toString(), key);
        }

        // Értesítjük a RoomManager-t a változásról
        await RoomManager.refreshSettings();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Hiba történt' });
    }
});

// Felhasználók listája
app.get('/api/admin/users', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT id, username, display_name, is_admin, created_at, last_login
            FROM rikiki_users
            ORDER BY created_at DESC
        `).all();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Hiba történt' });
    }
});

// Aktív szobák száma
app.get('/api/admin/rooms', requireAdmin, (req, res) => {
    res.json({
        count: RoomManager.rooms.size,
        rooms: Array.from(RoomManager.rooms.entries()).map(([code, room]) => ({
            code,
            status: room.game.status,
            players: room.game.players.length,
            humanPlayers: room.humanPlayers
        }))
    });
});

// Összes játék újraindítása
app.post('/api/admin/restart-all', requireAdmin, (req, res) => {
    // Értesítjük az összes klienst
    for (const [roomCode, room] of RoomManager.rooms) {
        RoomManager.broadcastToRoom(room, {
            type: 'gameRestarted',
            message: 'A játék újraindult. Kérlek csatlakozz újra!'
        });
    }

    // Szobák törlése
    RoomManager.rooms.clear();
    RoomManager.playerRooms.clear();

    res.json({ success: true });
});

// ============== ADMIN USER CREATION ==============

async function createAdminUser() {
    try {
        // Ellenőrizzük, létezik-e már az admin
        const existing = db.prepare('SELECT id FROM rikiki_users WHERE username = ?').get('Andriska');

        if (!existing) {
            const hashedPassword = await bcrypt.hash('p123', 10);
            db.prepare('INSERT INTO rikiki_users (username, password, display_name, is_admin) VALUES (?, ?, ?, ?)')
                .run('Andriska', hashedPassword, 'Andriska (Admin)', 1);
            console.log('Admin felhasználó létrehozva: Andriska / p123');
        }
    } catch (error) {
        console.error('Admin létrehozási hiba:', error);
    }
}

// ============== WEBSOCKET SERVER ==============

const wss = new WebSocket.Server({ port: WS_PORT });

console.log(`WebSocket szerver indítása a ${WS_PORT} porton...`);

wss.on('connection', (ws, req) => {
    console.log('Új WebSocket kapcsolat!');

    let userId = null;
    let playerId = null;
    let currentRoom = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('WS Üzenet:', data.type);

            switch (data.type) {
                case 'auth':
                    userId = data.userId;
                    const userName = data.userName || `Játékos_${userId}`;

                    const result = await RoomManager.joinOrCreateRoom(userId, userName, ws);
                    currentRoom = result.room;
                    playerId = result.playerId;

                    RoomManager.sendToClient(ws, {
                        type: 'authSuccess',
                        data: {
                            userId: userId,
                            playerId: playerId,
                            roomCode: currentRoom.code,
                            gameState: currentRoom.game.getPlayerState(playerId)
                        }
                    });

                    RoomManager.broadcastToRoom(currentRoom, {
                        type: 'playerJoined',
                        data: {
                            playerId: playerId,
                            playerName: userName,
                            playerCount: currentRoom.game.players.length
                        }
                    });
                    break;

                case 'startGame':
                    if (!currentRoom) {
                        throw new Error('Nincs aktív szoba!');
                    }

                    const gameState = await RoomManager.startGame(currentRoom.code);

                    RoomManager.broadcastToRoom(currentRoom, {
                        type: 'gameStarted',
                        data: gameState
                    });
                    break;

                case 'bid':
                    if (!currentRoom || !playerId) {
                        throw new Error('Nincs aktív játék!');
                    }

                    const bidState = currentRoom.game.placeBid(playerId, data.bid);

                    RoomManager.broadcastToRoom(currentRoom, {
                        type: 'gameState',
                        data: bidState
                    });

                    RoomManager.scheduleAIMove(currentRoom);
                    break;

                case 'playCard':
                    if (!currentRoom || !playerId) {
                        throw new Error('Nincs aktív játék!');
                    }

                    const playState = currentRoom.game.playCard(playerId, data.cardId);

                    RoomManager.broadcastToRoom(currentRoom, {
                        type: 'gameState',
                        data: playState
                    });

                    if (playState.status === 'roundEnd') {
                        setTimeout(() => {
                            currentRoom.game.startNewRound();
                            const newState = currentRoom.game.getGameState();

                            RoomManager.broadcastToRoom(currentRoom, {
                                type: 'gameState',
                                data: newState
                            });

                            RoomManager.scheduleAIMove(currentRoom);
                        }, 3000);
                    } else {
                        RoomManager.scheduleAIMove(currentRoom);
                    }
                    break;

                case 'getState':
                    if (currentRoom && playerId) {
                        RoomManager.sendToClient(ws, {
                            type: 'gameState',
                            data: currentRoom.game.getPlayerState(playerId)
                        });
                    }
                    break;

                case 'leaveGame':
                    console.log('Játékos kilép:', userId);

                    if (userId && currentRoom) {
                        RoomManager.handleDisconnect(userId);
                        currentRoom = null;
                        playerId = null;

                        RoomManager.sendToClient(ws, {
                            type: 'leftGame',
                            message: 'Sikeresen kiléptél a játékból.'
                        });
                    }
                    break;

                default:
                    console.log('Ismeretlen üzenet típus:', data.type);
            }

        } catch (error) {
            console.error('WS Hiba:', error.message);
            RoomManager.sendToClient(ws, {
                type: 'error',
                message: error.message
            });
        }
    });

    ws.on('close', () => {
        console.log('WebSocket kapcsolat bontva:', userId);
        if (userId) {
            RoomManager.handleDisconnect(userId);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket hiba:', error);
    });

    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// Ping-pong keepalive
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

// ============== SERVER START ==============

try {
    initDatabase();
    createAdminUser();

    app.listen(PORT, () => {
        console.log(`HTTP szerver fut: http://localhost:${PORT}`);
        console.log(`WebSocket szerver fut: ws://localhost:${WS_PORT}`);
    });
} catch (err) {
    console.error('Indítási hiba:', err);
    process.exit(1);
}
