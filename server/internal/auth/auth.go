package auth

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type Verifier struct {
	secret    []byte
	publicKey *rsa.PublicKey
	issuer    string
}

func New(secret, publicKeyPEM, issuer string) (*Verifier, error) {
	v := &Verifier{issuer: issuer}
	if publicKeyPEM != "" {
		key, err := parseRSAPublicKey(publicKeyPEM)
		if err != nil {
			return nil, err
		}
		v.publicKey = key
		return v, nil
	}
	if secret == "" {
		return nil, fmt.Errorf("jwt secret or public key required")
	}
	v.secret = []byte(secret)
	return v, nil
}

func (v *Verifier) Verify(tokenStr string) (userID string, err error) {
	tokenStr = strings.TrimSpace(tokenStr)
	if tokenStr == "" {
		return "", fmt.Errorf("empty token")
	}

	opts := []jwt.ParserOption{jwt.WithValidMethods(validMethods(v))}
	if v.issuer != "" {
		opts = append(opts, jwt.WithIssuer(v.issuer))
	}

	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		if v.publicKey != nil {
			return v.publicKey, nil
		}
		return v.secret, nil
	}, opts...)
	if err != nil {
		return "", err
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return "", fmt.Errorf("invalid token claims")
	}
	sub, err := claims.GetSubject()
	if err != nil || sub == "" {
		return "", fmt.Errorf("missing sub claim")
	}
	return sub, nil
}

func validMethods(v *Verifier) []string {
	if v.publicKey != nil {
		return []string{jwt.SigningMethodRS256.Alg()}
	}
	return []string{jwt.SigningMethodHS256.Alg()}
}

func parseRSAPublicKey(pemStr string) (*rsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("invalid PEM public key")
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaPub, ok := pub.(*rsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("not an RSA public key")
	}
	return rsaPub, nil
}
