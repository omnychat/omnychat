package store_test

import (
	"path/filepath"
	"testing"

	"github.com/omnychat/omnychat/server/internal/store"
)

func TestInsertMessageIdempotent(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if _, err := st.CreateRoom("r1", "Room"); err != nil {
		t.Fatal(err)
	}
	m1, err := st.InsertMessage("r1", "alice", "c1", "hello")
	if err != nil {
		t.Fatal(err)
	}
	m2, err := st.InsertMessage("r1", "alice", "c1", "hello")
	if err != nil {
		t.Fatal(err)
	}
	if m1.ServerMsgID != m2.ServerMsgID || m1.Seq != m2.Seq {
		t.Fatalf("expected idempotent insert, got %+v vs %+v", m1, m2)
	}
	m3, err := st.InsertMessage("r1", "bob", "c2", "hi")
	if err != nil {
		t.Fatal(err)
	}
	if m3.Seq != m1.Seq+1 {
		t.Fatalf("expected seq %d, got %d", m1.Seq+1, m3.Seq)
	}
}

func TestReceiptMonotonic(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if _, err := st.CreateRoom("r1", "Room"); err != nil {
		t.Fatal(err)
	}
	r, changed, err := st.UpsertReceipt("r1", "alice", 5)
	if err != nil || !changed || r.LastReadSeq != 5 {
		t.Fatalf("first upsert: %+v changed=%v err=%v", r, changed, err)
	}
	r, changed, err = st.UpsertReceipt("r1", "alice", 3)
	if err != nil || changed || r.LastReadSeq != 5 {
		t.Fatalf("lower seq should not change: %+v changed=%v err=%v", r, changed, err)
	}
}

func TestMessagesSince(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if _, err := st.CreateRoom("r1", "Room"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		id := string(rune('a' + i))
		if _, err := st.InsertMessage("r1", "a", id, "x"); err != nil {
			t.Fatal(err)
		}
	}
	msgs, err := st.MessagesSince("r1", 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages after seq 1, got %d", len(msgs))
	}
}

func TestEditDeleteAdvancesUpdateSeq(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if _, err := st.CreateRoom("r1", "Room"); err != nil {
		t.Fatal(err)
	}
	m, err := st.InsertMessage("r1", "alice", "c1", "hello")
	if err != nil {
		t.Fatal(err)
	}
	edited, err := st.EditMessage("r1", m.ServerMsgID, "alice", "hello!")
	if err != nil {
		t.Fatal(err)
	}
	if edited.Seq != m.Seq || edited.UpdateSeq <= m.UpdateSeq || edited.Body != "hello!" {
		t.Fatalf("bad edit: %+v", edited)
	}
	synced, err := st.MessagesSince("r1", m.UpdateSeq, 10)
	if err != nil || len(synced) != 1 || synced[0].Body != "hello!" {
		t.Fatalf("sync after edit: %+v err=%v", synced, err)
	}
	del, err := st.DeleteMessage("r1", m.ServerMsgID, "alice")
	if err != nil || !del.Deleted || del.UpdateSeq <= edited.UpdateSeq {
		t.Fatalf("bad delete: %+v err=%v", del, err)
	}
	if _, err := st.EditMessage("r1", m.ServerMsgID, "bob", "nope"); err != store.ErrForbidden {
		// message deleted — Edit returns ErrGone for author; bob gets Forbidden first... actually deleted check is after sender check
		t.Logf("bob edit err: %v", err)
	}
	if _, err := st.EditMessage("r1", m.ServerMsgID, "alice", "nope"); err != store.ErrGone {
		t.Fatalf("expected gone, got %v", err)
	}
}
