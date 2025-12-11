const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

// SQLite adatbázis létrehozása
const dbPath = path.join(__dirname, '../data/rikiki.db');
const db = new Database(dbPath);

// WAL mód a jobb teljesítményért
db.pragma('journal_mode = WAL');

// Adatbázis táblák létrehozása
function initDatabase() {
    // Felhasználók tábla
    db.exec(`
        CREATE TABLE IF NOT EXISTS rikiki_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            display_name TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_login TEXT
        )
    `);

    // Játék beállítások tábla
    db.exec(`
        CREATE TABLE IF NOT EXISTS rikiki_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT UNIQUE NOT NULL,
            setting_value TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Alapértelmezett beállítások beszúrása
    const defaultSettings = [
        ['player_count', '4'],
        ['max_rounds', '10'],
        ['thinking_time', '30'],
        ['allow_equal_bids', '0']
    ];

    const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO rikiki_settings (setting_key, setting_value)
        VALUES (?, ?)
    `);

    for (const [key, value] of defaultSettings) {
        insertSetting.run(key, value);
    }

    // Játék szobák tábla
    db.exec(`
        CREATE TABLE IF NOT EXISTS rikiki_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_code TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'waiting',
            player_count INTEGER DEFAULT 4,
            current_round INTEGER DEFAULT 0,
            max_rounds INTEGER DEFAULT 10,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Játékosok a szobában
    db.exec(`
        CREATE TABLE IF NOT EXISTS rikiki_room_players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            user_id INTEGER,
            player_name TEXT NOT NULL,
            is_ai INTEGER DEFAULT 0,
            seat_position INTEGER NOT NULL,
            is_ready INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Játék körök
    db.exec(`
        CREATE TABLE IF NOT EXISTS rikiki_rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            round_number INTEGER NOT NULL,
            card_count INTEGER NOT NULL,
            trump_suit TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Játékos körönkénti adatok
    db.exec(`
        CREATE TABLE IF NOT EXISTS rikiki_player_rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            round_id INTEGER NOT NULL,
            player_id INTEGER NOT NULL,
            bid INTEGER,
            tricks_won INTEGER DEFAULT 0,
            score INTEGER DEFAULT 0
        )
    `);

    // Felhasználói statisztikák
    db.exec(`
        CREATE TABLE IF NOT EXISTS rikiki_user_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            user_name TEXT,
            games_played INTEGER DEFAULT 0,
            games_won INTEGER DEFAULT 0,
            total_score INTEGER DEFAULT 0,
            highest_score INTEGER DEFAULT 0,
            rank_points INTEGER DEFAULT 1000,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Játék történet
    db.exec(`
        CREATE TABLE IF NOT EXISTS rikiki_game_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            user_id INTEGER,
            final_score INTEGER NOT NULL,
            position INTEGER NOT NULL,
            played_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log('SQLite adatbázis inicializálva!');
}

module.exports = { db, initDatabase };
