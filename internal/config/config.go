package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ListenAddr string
	DBPath string
	PortMin int
	PortMax int
}

func Load() (Config, error) {
	c := Config{
		ListenAddr: env("APOLO_INFRA_LISTEN_ADDR", "127.0.0.1:8787"),
		DBPath: env("APOLO_INFRA_DB_PATH", "./data/apolo-infra.db"),
		PortMin: 20000,
		PortMax: 29999,
	}
	var err error
	if c.PortMin, err = intEnv("APOLO_INFRA_PORT_MIN", c.PortMin); err != nil { return Config{}, err }
	if c.PortMax, err = intEnv("APOLO_INFRA_PORT_MAX", c.PortMax); err != nil { return Config{}, err }
	if _, _, err := net.SplitHostPort(c.ListenAddr); err != nil { return Config{}, fmt.Errorf("invalid listen address: %w", err) }
	if strings.TrimSpace(c.DBPath) == "" { return Config{}, fmt.Errorf("database path cannot be empty") }
	if c.PortMin < 1024 || c.PortMax > 65535 || c.PortMin > c.PortMax { return Config{}, fmt.Errorf("invalid TCP port range %d-%d", c.PortMin, c.PortMax) }
	return c, nil
}

func env(key, fallback string) string { if v := strings.TrimSpace(os.Getenv(key)); v != "" { return v }; return fallback }
func intEnv(key string, fallback int) (int, error) { v := strings.TrimSpace(os.Getenv(key)); if v == "" { return fallback, nil }; n, err := strconv.Atoi(v); if err != nil { return 0, fmt.Errorf("%s must be an integer: %w", key, err) }; return n, nil }
