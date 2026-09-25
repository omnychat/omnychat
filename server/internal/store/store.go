package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type Room struct {
	ID              string
	Name            string
	CreatedAtUnixMs int64
}

type Message struct {
	ServerMsgID     string
	ClientMsgID     string
	RoomID          string
	SenderID        string
	Body            string
	Seq             uint64
	UpdateSeq       uint64
	CreatedAtUnixMs int64
	EditedAtUnixMs  int64
	Deleted         bool
}

type Receipt struct {
	RoomID          string
	UserID          string
	LastReadSeq     uint64
	UpdatedAtUnixMs int64
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if _, err := db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Ping() error {
	return s.db.Ping()
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at_ms INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE TABLE IF NOT EXISTS room_seq (
  room_id TEXT PRIMARY KEY,
  next_seq INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  client_msg_id TEXT NOT NULL,
  body TEXT NOT NULL,
  seq INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  update_seq INTEGER NOT NULL DEFAULT 0,
  edited_at_ms INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  UNIQUE (room_id, client_msg_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_id, seq);
CREATE TABLE IF NOT EXISTS receipts (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_seq INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
`)
	if err != nil {
		return err
	}
	if err := s.ensureMessageColumns(); err != nil {
		return err
	}
	_, err = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_messages_room_update_seq ON messages(room_id, update_seq)`)
	return err
}

func (s *Store) ensureMessageColumns() error {
	cols := map[string]string{
		"update_seq":   "INTEGER NOT NULL DEFAULT 0",
		"edited_at_ms": "INTEGER NOT NULL DEFAULT 0",
		"deleted":      "INTEGER NOT NULL DEFAULT 0",
	}
	existing := map[string]bool{}
	rows, err := s.db.Query(`PRAGMA table_info(messages)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		existing[name] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for name, def := range cols {
		if existing[name] {
			continue
		}
		if _, err := s.db.Exec(`ALTER TABLE messages ADD COLUMN ` + name + ` ` + def); err != nil {
			return err
		}
	}
	_, err = s.db.Exec(`UPDATE messages SET update_seq = seq WHERE update_seq = 0 OR update_seq IS NULL`)
	return err
}

func (s *Store) CreateRoom(id, name string) (Room, error) {
	now := time.Now().UnixMilli()
	tx, err := s.db.Begin()
	if err != nil {
		return Room{}, err
	}
	defer func() { _ = tx.Rollback() }()

	_, err = tx.Exec(`INSERT INTO rooms (id, name, created_at_ms) VALUES (?, ?, ?)`, id, name, now)
	if err != nil {
		return Room{}, err
	}
	_, err = tx.Exec(`INSERT INTO room_seq (room_id, next_seq) VALUES (?, 1)`, id)
	if err != nil {
		return Room{}, err
	}
	if err := tx.Commit(); err != nil {
		return Room{}, err
	}
	return Room{ID: id, Name: name, CreatedAtUnixMs: now}, nil
}

func (s *Store) GetRoom(id string) (Room, error) {
	var r Room
	err := s.db.QueryRow(`SELECT id, name, created_at_ms FROM rooms WHERE id = ?`, id).
		Scan(&r.ID, &r.Name, &r.CreatedAtUnixMs)
	if err == sql.ErrNoRows {
		return Room{}, ErrNotFound
	}
	return r, err
}

func (s *Store) EnsureMember(roomID, userID string) error {
	_, err := s.db.Exec(
		`INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at_ms) VALUES (?, ?, ?)`,
		roomID, userID, time.Now().UnixMilli(),
	)
	return err
}

// LatestSeq returns the highest update_seq for the room (sync cursor).
func (s *Store) LatestSeq(roomID string) (uint64, error) {
	var seq sql.NullInt64
	err := s.db.QueryRow(`SELECT MAX(update_seq) FROM messages WHERE room_id = ?`, roomID).Scan(&seq)
	if err != nil {
		return 0, err
	}
	if !seq.Valid {
		return 0, nil
	}
	return uint64(seq.Int64), nil
}

func scanMessage(scanner interface {
	Scan(dest ...any) error
}) (Message, error) {
	var m Message
	var deleted int
	err := scanner.Scan(
		&m.ServerMsgID, &m.RoomID, &m.SenderID, &m.ClientMsgID, &m.Body,
		&m.Seq, &m.CreatedAtUnixMs, &m.UpdateSeq, &m.EditedAtUnixMs, &deleted,
	)
	if err != nil {
		return Message{}, err
	}
	m.Deleted = deleted != 0
	return m, nil
}

const messageSelectCols = `id, room_id, sender_id, client_msg_id, body, seq, created_at_ms, update_seq, edited_at_ms, deleted`

// InsertMessage inserts or returns the existing message for (room_id, client_msg_id).
func (s *Store) InsertMessage(roomID, senderID, clientMsgID, body string) (Message, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return Message{}, err
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := scanMessage(tx.QueryRow(`
SELECT `+messageSelectCols+`
FROM messages WHERE room_id = ? AND client_msg_id = ?`, roomID, clientMsgID))
	if err == nil {
		if err := tx.Commit(); err != nil {
			return Message{}, err
		}
		return existing, nil
	}
	if err != sql.ErrNoRows {
		return Message{}, err
	}

	var nextSeq int64
	err = tx.QueryRow(`SELECT next_seq FROM room_seq WHERE room_id = ?`, roomID).Scan(&nextSeq)
	if err == sql.ErrNoRows {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, err
	}
	_, err = tx.Exec(`UPDATE room_seq SET next_seq = ? WHERE room_id = ?`, nextSeq+1, roomID)
	if err != nil {
		return Message{}, err
	}

	now := time.Now().UnixMilli()
	id := uuid.NewString()
	_, err = tx.Exec(`
INSERT INTO messages (id, room_id, sender_id, client_msg_id, body, seq, created_at_ms, update_seq, edited_at_ms, deleted)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`, id, roomID, senderID, clientMsgID, body, nextSeq, now, nextSeq)
	if err != nil {
		return Message{}, err
	}
	if err := tx.Commit(); err != nil {
		return Message{}, err
	}
	return Message{
		ServerMsgID:     id,
		ClientMsgID:     clientMsgID,
		RoomID:          roomID,
		SenderID:        senderID,
		Body:            body,
		Seq:             uint64(nextSeq),
		UpdateSeq:       uint64(nextSeq),
		CreatedAtUnixMs: now,
	}, nil
}

func (s *Store) GetMessage(roomID, serverMsgID string) (Message, error) {
	m, err := scanMessage(s.db.QueryRow(`
SELECT `+messageSelectCols+` FROM messages WHERE room_id = ? AND id = ?`, roomID, serverMsgID))
	if err == sql.ErrNoRows {
		return Message{}, ErrNotFound
	}
	return m, err
}

func (s *Store) EditMessage(roomID, serverMsgID, senderID, body string) (Message, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return Message{}, err
	}
	defer func() { _ = tx.Rollback() }()

	m, err := scanMessage(tx.QueryRow(`
SELECT `+messageSelectCols+` FROM messages WHERE room_id = ? AND id = ?`, roomID, serverMsgID))
	if err == sql.ErrNoRows {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, err
	}
	if m.SenderID != senderID {
		return Message{}, ErrForbidden
	}
	if m.Deleted {
		return Message{}, ErrGone
	}

	var nextSeq int64
	err = tx.QueryRow(`SELECT next_seq FROM room_seq WHERE room_id = ?`, roomID).Scan(&nextSeq)
	if err != nil {
		return Message{}, err
	}
	_, err = tx.Exec(`UPDATE room_seq SET next_seq = ? WHERE room_id = ?`, nextSeq+1, roomID)
	if err != nil {
		return Message{}, err
	}

	now := time.Now().UnixMilli()
	_, err = tx.Exec(`
UPDATE messages SET body = ?, edited_at_ms = ?, update_seq = ? WHERE room_id = ? AND id = ?`,
		body, now, nextSeq, roomID, serverMsgID)
	if err != nil {
		return Message{}, err
	}
	if err := tx.Commit(); err != nil {
		return Message{}, err
	}
	m.Body = body
	m.EditedAtUnixMs = now
	m.UpdateSeq = uint64(nextSeq)
	return m, nil
}

func (s *Store) DeleteMessage(roomID, serverMsgID, senderID string) (Message, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return Message{}, err
	}
	defer func() { _ = tx.Rollback() }()

	m, err := scanMessage(tx.QueryRow(`
SELECT `+messageSelectCols+` FROM messages WHERE room_id = ? AND id = ?`, roomID, serverMsgID))
	if err == sql.ErrNoRows {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, err
	}
	if m.SenderID != senderID {
		return Message{}, ErrForbidden
	}
	if m.Deleted {
		if err := tx.Commit(); err != nil {
			return Message{}, err
		}
		return m, nil
	}

	var nextSeq int64
	err = tx.QueryRow(`SELECT next_seq FROM room_seq WHERE room_id = ?`, roomID).Scan(&nextSeq)
	if err != nil {
		return Message{}, err
	}
	_, err = tx.Exec(`UPDATE room_seq SET next_seq = ? WHERE room_id = ?`, nextSeq+1, roomID)
	if err != nil {
		return Message{}, err
	}

	now := time.Now().UnixMilli()
	_, err = tx.Exec(`
UPDATE messages SET deleted = 1, body = '', edited_at_ms = CASE WHEN edited_at_ms = 0 THEN ? ELSE edited_at_ms END, update_seq = ?
WHERE room_id = ? AND id = ?`, now, nextSeq, roomID, serverMsgID)
	if err != nil {
		return Message{}, err
	}
	if err := tx.Commit(); err != nil {
		return Message{}, err
	}
	m.Deleted = true
	m.Body = ""
	m.UpdateSeq = uint64(nextSeq)
	if m.EditedAtUnixMs == 0 {
		m.EditedAtUnixMs = now
	}
	return m, nil
}

func (s *Store) MessagesSince(roomID string, sinceSeq uint64, limit int) ([]Message, error) {
	if limit <= 0 {
		limit = 500
	}
	rows, err := s.db.Query(`
SELECT `+messageSelectCols+`
FROM messages WHERE room_id = ? AND update_seq > ? ORDER BY update_seq ASC LIMIT ?`, roomID, sinceSeq, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// UpsertReceipt stores max(last_read_seq). Returns the effective receipt and whether it changed.
func (s *Store) UpsertReceipt(roomID, userID string, lastReadSeq uint64) (Receipt, bool, error) {
	now := time.Now().UnixMilli()
	tx, err := s.db.Begin()
	if err != nil {
		return Receipt{}, false, err
	}
	defer func() { _ = tx.Rollback() }()

	var cur uint64
	err = tx.QueryRow(`SELECT last_read_seq FROM receipts WHERE room_id = ? AND user_id = ?`, roomID, userID).Scan(&cur)
	if err != nil && err != sql.ErrNoRows {
		return Receipt{}, false, err
	}
	if err == nil && lastReadSeq <= cur {
		if err := tx.Commit(); err != nil {
			return Receipt{}, false, err
		}
		return Receipt{RoomID: roomID, UserID: userID, LastReadSeq: cur, UpdatedAtUnixMs: now}, false, nil
	}

	_, err = tx.Exec(`
INSERT INTO receipts (room_id, user_id, last_read_seq, updated_at_ms) VALUES (?, ?, ?, ?)
ON CONFLICT(room_id, user_id) DO UPDATE SET
  last_read_seq = excluded.last_read_seq,
  updated_at_ms = excluded.updated_at_ms`, roomID, userID, lastReadSeq, now)
	if err != nil {
		return Receipt{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return Receipt{}, false, err
	}
	return Receipt{RoomID: roomID, UserID: userID, LastReadSeq: lastReadSeq, UpdatedAtUnixMs: now}, true, nil
}

var (
	ErrNotFound  = fmt.Errorf("not found")
	ErrForbidden = fmt.Errorf("forbidden")
	ErrGone      = fmt.Errorf("gone")
)
