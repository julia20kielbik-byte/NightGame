const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const { customAlphabet, nanoid } = require("nanoid");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, "party-groups.db"));

const createRoomCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    admin_name TEXT NOT NULL,
    admin_password_hash TEXT NOT NULL,
    admin_token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    group_id INTEGER,
    is_admin INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    group_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    color_name TEXT NOT NULL,
    color_hex TEXT NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );
`);

try {
  db.prepare(
    "ALTER TABLE participants ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"
  ).run();
} catch (error) {
  if (!String(error.message).includes("duplicate column name")) {
    throw error;
  }
}

const migrateExistingAdmins = db.transaction(() => {
  const rooms = db.prepare("SELECT id, admin_name FROM rooms").all();

  const findAdminParticipant = db.prepare(`
    SELECT id
    FROM participants
    WHERE room_id = ? AND is_admin = 1
    LIMIT 1
  `);

  const findParticipantByName = db.prepare(`
    SELECT id
    FROM participants
    WHERE room_id = ? AND LOWER(name) = LOWER(?)
    ORDER BY id
    LIMIT 1
  `);

  const markAsAdmin = db.prepare(`
    UPDATE participants
    SET is_admin = 1
    WHERE id = ?
  `);

  const insertAdmin = db.prepare(`
    INSERT INTO participants (room_id, name, session_token, is_admin)
    VALUES (?, ?, ?, 1)
  `);

  for (const room of rooms) {
    if (findAdminParticipant.get(room.id)) {
      continue;
    }

    const matchingParticipant = findParticipantByName.get(
      room.id,
      room.admin_name
    );

    if (matchingParticipant) {
      markAsAdmin.run(matchingParticipant.id);
    } else {
      insertAdmin.run(room.id, room.admin_name, nanoid(32));
    }
  }
});

migrateExistingAdmins();

const COLORS = [
  { name: "Czarna", hex: "#000000" },
  { name: "Biała", hex: "#FEFEFE" },
  { name: "Czerwona", hex: "#ef4444" },
  { name: "Niebieska", hex: "#3b82f6" },
  { name: "Zielona", hex: "#22c55e" },
  { name: "Żółta", hex: "#eab308" },
  { name: "Fioletowa", hex: "#8b5cf6" },
  { name: "Pomarańczowa", hex: "#f97316" },
  { name: "Różowa", hex: "#ec4899" },
  { name: "Granatowa", hex: "#1e3a8a" },
  { name: "Bordowa", hex: "#9f1239" },
  { name: "Brązowa", hex: "#92400e" }
];

function cleanText(value, maxLength = 60) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getRoomByCode(code) {
  return db
    .prepare("SELECT * FROM rooms WHERE code = ?")
    .get(String(code || "").trim().toUpperCase());
}

function requireAdmin(req, res, next) {
  const token = req.header("x-admin-token");
  const room = getRoomByCode(req.params.code);

  if (!room) {
    return res.status(404).json({ error: "Nie znaleziono pokoju." });
  }

  if (!token || token !== room.admin_token) {
    return res.status(403).json({ error: "Brak uprawnień administratora." });
  }

  req.room = room;
  next();
}

function getRoomState(room, participantToken = null, includeAdminData = false) {
  const participants = db
    .prepare(`
      SELECT p.id, p.name, p.joined_at, p.group_id, p.is_admin,
             g.group_number, g.name AS group_name,
             g.color_name, g.color_hex
      FROM participants p
      LEFT JOIN groups g ON g.id = p.group_id
      WHERE p.room_id = ?
      ORDER BY p.joined_at ASC, p.id ASC
    `)
    .all(room.id);

  const groups = db
    .prepare(`
      SELECT id, group_number, name, color_name, color_hex
      FROM groups
      WHERE room_id = ?
      ORDER BY group_number ASC
    `)
    .all(room.id)
    .map((group) => ({
      ...group,
      participants: participants
        .filter((participant) => participant.group_id === group.id)
        .map((participant) => ({
          id: participant.id,
          name: participant.name
        }))
    }));

  const currentParticipant = participantToken
    ? db
        .prepare(`
          SELECT p.id, p.name, p.group_id,
                 g.group_number, g.name AS group_name,
                 g.color_name, g.color_hex
          FROM participants p
          LEFT JOIN groups g ON g.id = p.group_id
          WHERE p.room_id = ? AND p.session_token = ?
        `)
        .get(room.id, participantToken)
    : null;

  const result = {
    room: {
      code: room.code,
      name: room.name,
      adminName: room.admin_name,
      status: room.status,
      participantCount: participants.length,
      createdAt: room.created_at
    },
    participants: participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      isAdmin: Boolean(participant.is_admin),
      groupId: participant.group_id,
      groupNumber: participant.group_number,
      groupName: participant.group_name,
      colorName: participant.color_name,
      colorHex: participant.color_hex
    })),
    groups,
    currentParticipant
  };

  if (includeAdminData) {
    result.room.isAdmin = true;
  }

  return result;
}

function buildGroupProposals(totalPeople) {
  if (totalPeople < 2) {
    return [];
  }

  const proposals = [];

  for (let groupCount = 2; groupCount <= Math.min(totalPeople, 12); groupCount += 1) {
    const baseSize = Math.floor(totalPeople / groupCount);
    const largerGroups = totalPeople % groupCount;
    const smallerGroups = groupCount - largerGroups;
    const largestSize = baseSize + (largerGroups > 0 ? 1 : 0);

    if (baseSize < 2 || largestSize > 14) {
      continue;
    }

    let description;

    if (largerGroups === 0) {
      description = `${groupCount} ${groupCount === 1 ? "grupa" : groupCount < 5 ? "grupy" : "grup"} po ${baseSize} osób`;
    } else {
      const parts = [];
      if (largerGroups > 0) {
        parts.push(
          `${largerGroups} ${largerGroups === 1 ? "grupa" : largerGroups < 5 ? "grupy" : "grup"} po ${baseSize + 1} osób`
        );
      }
      if (smallerGroups > 0) {
        parts.push(
          `${smallerGroups} ${smallerGroups === 1 ? "grupa" : smallerGroups < 5 ? "grupy" : "grup"} po ${baseSize} osób`
        );
      }
      description = parts.join(" i ");
    }

    const idealSize = 6.5;
    const averageSize = totalPeople / groupCount;
    const score =
      Math.abs(averageSize - idealSize) +
      (largerGroups > 0 ? 0.25 : 0) +
      (groupCount > COLORS.length ? 3 : 0);

    proposals.push({
      groupCount,
      averageSize: Number(averageSize.toFixed(2)),
      minSize: baseSize,
      maxSize: largestSize,
      perfectlyEqual: largerGroups === 0,
      description,
      score
    });
  }

  return proposals
    .sort((a, b) => {
      if (a.perfectlyEqual !== b.perfectlyEqual) {
        return a.perfectlyEqual ? -1 : 1;
      }
      return a.score - b.score;
    })
    .slice(0, 8)
    .map(({ score, ...proposal }) => proposal);
}

function shuffle(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }

  return copy;
}

app.post("/api/rooms", async (req, res) => {
  try {
    const name = cleanText(req.body.name, 80);
    const adminName = cleanText(req.body.adminName, 50);
    const password = String(req.body.password || "");

    if (name.length < 3) {
      return res.status(400).json({ error: "Nazwa wydarzenia musi mieć co najmniej 3 znaki." });
    }

    if (adminName.length < 2) {
      return res.status(400).json({ error: "Imię administratora musi mieć co najmniej 2 znaki." });
    }

    if (password.length < 4) {
      return res.status(400).json({ error: "Hasło administratora musi mieć co najmniej 4 znaki." });
    }

    let code;
    do {
      code = createRoomCode();
    } while (getRoomByCode(code));

    const passwordHash = await bcrypt.hash(password, 10);
    const adminToken = nanoid(32);

    db.transaction(() => {
      const roomResult = db.prepare(`
        INSERT INTO rooms (code, name, admin_name, admin_password_hash, admin_token)
        VALUES (?, ?, ?, ?, ?)
      `).run(code, name, adminName, passwordHash, adminToken);

      db.prepare(`
        INSERT INTO participants (room_id, name, session_token, is_admin)
        VALUES (?, ?, ?, 1)
      `).run(roomResult.lastInsertRowid, adminName, nanoid(32));
    })();

    res.status(201).json({
      code,
      adminToken
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Nie udało się utworzyć pokoju." });
  }
});

app.post("/api/rooms/:code/admin-login", async (req, res) => {
  try {
    const room = getRoomByCode(req.params.code);
    const password = String(req.body.password || "");

    if (!room) {
      return res.status(404).json({ error: "Nie znaleziono pokoju." });
    }

    const valid = await bcrypt.compare(password, room.admin_password_hash);

    if (!valid) {
      return res.status(401).json({ error: "Nieprawidłowe hasło administratora." });
    }

    res.json({ adminToken: room.admin_token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Nie udało się zalogować administratora." });
  }
});

app.post("/api/rooms/:code/join", (req, res) => {
  try {
    const room = getRoomByCode(req.params.code);
    const name = cleanText(req.body.name, 40);

    if (!room) {
      return res.status(404).json({ error: "Nie znaleziono pokoju." });
    }

    if (room.status !== "open") {
      return res.status(409).json({ error: "Zapisy do tego pokoju są już zamknięte." });
    }

    if (name.length < 2) {
      return res.status(400).json({ error: "Imię lub pseudonim musi mieć co najmniej 2 znaki." });
    }

    const duplicate = db
      .prepare("SELECT id FROM participants WHERE room_id = ? AND LOWER(name) = LOWER(?)")
      .get(room.id, name);

    if (duplicate) {
      return res.status(409).json({ error: "Osoba o takim imieniu już dołączyła." });
    }

    const sessionToken = nanoid(32);

    db.prepare(`
      INSERT INTO participants (room_id, name, session_token)
      VALUES (?, ?, ?)
    `).run(room.id, name, sessionToken);

    res.status(201).json({ sessionToken });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Nie udało się dołączyć do pokoju." });
  }
});

app.get("/api/rooms/:code", (req, res) => {
  try {
    const room = getRoomByCode(req.params.code);

    if (!room) {
      return res.status(404).json({ error: "Nie znaleziono pokoju." });
    }

    const participantToken = req.header("x-participant-token");
    const adminToken = req.header("x-admin-token");
    const includeAdminData = adminToken && adminToken === room.admin_token;

    res.json(getRoomState(room, participantToken, includeAdminData));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Nie udało się pobrać danych pokoju." });
  }
});

app.post("/api/rooms/:code/close", requireAdmin, (req, res) => {
  try {
    const participantCount = db
      .prepare("SELECT COUNT(*) AS count FROM participants WHERE room_id = ?")
      .get(req.room.id).count;

    if (participantCount < 2) {
      return res.status(400).json({ error: "Do losowania potrzebne są co najmniej 2 osoby." });
    }

    db.prepare("UPDATE rooms SET status = 'locked' WHERE id = ?").run(req.room.id);

    res.json({
      message: "Zapisy zostały zamknięte.",
      proposals: buildGroupProposals(participantCount)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Nie udało się zamknąć zapisów." });
  }
});

app.post("/api/rooms/:code/reopen", requireAdmin, (req, res) => {
  try {
    db.transaction(() => {
      db.prepare("UPDATE participants SET group_id = NULL WHERE room_id = ?").run(req.room.id);
      db.prepare("DELETE FROM groups WHERE room_id = ?").run(req.room.id);
      db.prepare("UPDATE rooms SET status = 'open' WHERE id = ?").run(req.room.id);
    })();

    res.json({ message: "Zapisy zostały ponownie otwarte." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Nie udało się otworzyć zapisów." });
  }
});

app.get("/api/rooms/:code/proposals", requireAdmin, (req, res) => {
  try {
    const participantCount = db
      .prepare("SELECT COUNT(*) AS count FROM participants WHERE room_id = ?")
      .get(req.room.id).count;

    res.json({
      participantCount,
      proposals: buildGroupProposals(participantCount)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Nie udało się przygotować propozycji." });
  }
});

app.post("/api/rooms/:code/draw", requireAdmin, (req, res) => {
  try {
    const groupCount = Number(req.body.groupCount);
    const participants = db
      .prepare("SELECT id, name FROM participants WHERE room_id = ? ORDER BY id")
      .all(req.room.id);

    if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > participants.length) {
      return res.status(400).json({ error: "Nieprawidłowa liczba grup." });
    }

    if (groupCount > COLORS.length) {
      return res.status(400).json({
        error: `Maksymalna liczba grup w tej wersji to ${COLORS.length}.`
      });
    }

    const proposals = buildGroupProposals(participants.length);

    if (!proposals.some((proposal) => proposal.groupCount === groupCount)) {
      return res.status(400).json({ error: "Wybrany podział nie jest dostępny." });
    }

    const shuffled = shuffle(participants);

    db.transaction(() => {
      db.prepare("UPDATE participants SET group_id = NULL WHERE room_id = ?").run(req.room.id);
      db.prepare("DELETE FROM groups WHERE room_id = ?").run(req.room.id);

      const insertGroup = db.prepare(`
        INSERT INTO groups (room_id, group_number, name, color_name, color_hex)
        VALUES (?, ?, ?, ?, ?)
      `);

      const groupIds = [];

      for (let index = 0; index < groupCount; index += 1) {
        const color = COLORS[index];
        const result = insertGroup.run(
          req.room.id,
          index + 1,
          `Grupa ${color.name.toLowerCase()}`,
          color.name,
          color.hex
        );
        groupIds.push(result.lastInsertRowid);
      }

      const updateParticipant = db.prepare(
        "UPDATE participants SET group_id = ? WHERE id = ?"
      );

      shuffled.forEach((participant, index) => {
        const groupIndex = index % groupCount;
        updateParticipant.run(groupIds[groupIndex], participant.id);
      });

      db.prepare("UPDATE rooms SET status = 'drawn' WHERE id = ?").run(req.room.id);
    })();

    const updatedRoom = getRoomByCode(req.params.code);
    res.json(getRoomState(updatedRoom, null, true));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Nie udało się wylosować grup." });
  }
});

app.delete("/api/rooms/:code/participants/:participantId", requireAdmin, (req, res) => {
  try {
    if (req.room.status !== "open") {
      return res.status(409).json({
        error: "Uczestników można usuwać tylko przed zamknięciem zapisów."
      });
    }

    const participant = db
      .prepare(`
        SELECT id, is_admin
        FROM participants
        WHERE id = ? AND room_id = ?
      `)
      .get(Number(req.params.participantId), req.room.id);

    if (!participant) {
      return res.status(404).json({ error: "Nie znaleziono uczestnika." });
    }

    if (participant.is_admin) {
      return res.status(409).json({
        error: "Administrator musi pozostać na liście uczestników."
      });
    }

    db.prepare("DELETE FROM participants WHERE id = ? AND room_id = ?")
      .run(participant.id, req.room.id);

    res.json({ message: "Uczestnik został usunięty." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Nie udało się usunąć uczestnika." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Aplikacja działa pod adresem http://localhost:${PORT}`);
});
