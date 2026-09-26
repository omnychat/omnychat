package auth_test

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/omnychat/omnychat/server/internal/auth"
)

func TestVerifyHS256(t *testing.T) {
	secret := "test-secret"
	v, err := auth.New(secret, "", "")
	if err != nil {
		t.Fatal(err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "alice",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	uid, err := v.Verify(signed)
	if err != nil || uid != "alice" {
		t.Fatalf("got %q err=%v", uid, err)
	}
}

func TestRejectExpired(t *testing.T) {
	secret := "test-secret"
	v, err := auth.New(secret, "", "")
	if err != nil {
		t.Fatal(err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "alice",
		"exp": time.Now().Add(-time.Hour).Unix(),
	})
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.Verify(signed); err == nil {
		t.Fatal("expected error for expired token")
	}
}
